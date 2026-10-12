import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import {
  endpointKey,
  FAVORITE_ROUTE_LIMIT,
  routeKeyOf,
} from '../../domain/user/models/favorite-route';
import { IFavoriteRouteRepository } from '../../domain/user/ports/IFavoriteRouteRepository';
import { FavoriteRouteService } from './favorite-route.service';

describe('routeKeyOf', () => {
  it('uses the station id for a station and ignores the name', () => {
    expect(endpointKey({ stationId: '09_907', lat: null, lng: null })).toBe('S:09_907');
  });

  it('rounds a place to four decimals so a tiny coordinate change is the same place', () => {
    const a = endpointKey({ stationId: null, lat: 37.56650001, lng: 126.97800004 });
    const b = endpointKey({ stationId: null, lat: 37.5665, lng: 126.978 });

    expect(a).toBe(b);
    expect(a).toBe('P:37.5665,126.9780');
  });

  it('treats places about 11m apart as different', () => {
    const a = endpointKey({ stationId: null, lat: 37.5665, lng: 126.978 });
    const b = endpointKey({ stationId: null, lat: 37.5666, lng: 126.978 });

    expect(a).not.toBe(b);
  });

  it('prefers the station over coordinates when both are given', () => {
    expect(endpointKey({ stationId: '02_222', lat: 37.5, lng: 127 })).toBe('S:02_222');
  });

  it('is directional: A to B is not B to A', () => {
    const a = { stationId: '09_907', lat: null, lng: null };
    const b = { stationId: '09_925', lat: null, lng: null };

    expect(routeKeyOf(a, b)).toBe('S:09_907>S:09_925');
    expect(routeKeyOf(a, b)).not.toBe(routeKeyOf(b, a));
  });
});

describe('FavoriteRouteService', () => {
  let repo: jest.Mocked<IFavoriteRouteRepository>;
  let graph: { getGraph: jest.Mock };
  let service: FavoriteRouteService;
  const known = new Set(['09_907', '09_925', '02_222']);
  const now = new Date('2026-10-12T09:00:00Z');

  const saved = (id: string, originId: string, destId: string) => ({
    id,
    origin: { name: originId, stationId: originId, lat: null, lng: null },
    destination: { name: destId, stationId: destId, lat: null, lng: null },
    createdAt: now,
  });

  beforeEach(() => {
    repo = {
      findAll: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findByKey: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(async (_userId, favorite) => ({
          id: 'fav-1',
          origin: favorite.origin,
          destination: favorite.destination,
          createdAt: now,
        })),
      remove: jest.fn().mockResolvedValue(true),
    };
    graph = {
      getGraph: jest.fn().mockReturnValue({
        indexOf: (id: string) => (known.has(id) ? 1 : undefined),
      }),
    };
    service = new FavoriteRouteService(
      repo,
      graph as unknown as SubwayGraphService,
    );
  });

  describe('list', () => {
    it('returns the favorites with the limit and a KST time', async () => {
      repo.findAll.mockResolvedValue([saved('fav-1', '09_907', '09_925')]);

      const result = await service.list('user-1');

      expect(result.limit).toBe(FAVORITE_ROUTE_LIMIT);
      expect(result.favorites).toHaveLength(1);
      expect(result.favorites[0].id).toBe('fav-1');
      expect(result.favorites[0].createdAt).toBe('2026-10-12T18:00:00.000+09:00');
    });

    it('returns an empty list when nothing is saved', async () => {
      await expect(service.list('user-1')).resolves.toEqual({
        favorites: [],
        limit: FAVORITE_ROUTE_LIMIT,
      });
    });
  });

  describe('save', () => {
    const station = (name: string, stationId: string) => ({ name, stationId });

    it('saves a station to station route with its key', async () => {
      const result = await service.save('user-1', {
        origin: station('가양', '09_907'),
        destination: station('신논현', '09_925'),
      });

      expect(repo.create).toHaveBeenCalledWith('user-1', {
        origin: { name: '가양', stationId: '09_907', lat: null, lng: null },
        destination: { name: '신논현', stationId: '09_925', lat: null, lng: null },
        routeKey: 'S:09_907>S:09_925',
      });
      expect(result).toMatchObject({ id: 'fav-1', alreadySaved: false });
    });

    it('saves a place by coordinates without a station', async () => {
      await service.save('user-1', {
        origin: { name: '우리집', lat: 37.5, lng: 127.1 },
        destination: station('신논현', '09_925'),
      });

      expect(repo.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          origin: { name: '우리집', stationId: null, lat: 37.5, lng: 127.1 },
          routeKey: 'P:37.5000,127.1000>S:09_925',
        }),
      );
    });

    it('prefers the station when both a station and coordinates are given', async () => {
      await service.save('user-1', {
        origin: { name: '가양', stationId: '09_907', lat: 37.5, lng: 127.1 },
        destination: station('신논현', '09_925'),
      });

      expect(repo.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          origin: { name: '가양', stationId: '09_907', lat: null, lng: null },
        }),
      );
    });

    it('returns the existing favorite instead of creating a duplicate', async () => {
      repo.findByKey.mockResolvedValue(saved('fav-9', '09_907', '09_925'));

      const result = await service.save('user-1', {
        origin: station('가양역', '09_907'),
        destination: station('신논현역', '09_925'),
      });

      expect(repo.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'fav-9', alreadySaved: true });
    });

    it('rejects an endpoint with neither a station nor coordinates', async () => {
      await expect(
        service.save('user-1', {
          origin: { name: '어딘가' },
          destination: station('신논현', '09_925'),
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_REQUEST_PAYLOAD' });
    });

    it('rejects coordinates with only one of lat and lng', async () => {
      await expect(
        service.save('user-1', {
          origin: { name: '어딘가', lat: 37.5 },
          destination: station('신논현', '09_925'),
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_REQUEST_PAYLOAD' });
    });

    it('answers 404 for a station that does not exist', async () => {
      await expect(
        service.save('user-1', {
          origin: station('없는역', '99_999'),
          destination: station('신논현', '09_925'),
        }),
      ).rejects.toMatchObject({ errorCode: 'STATION_NOT_FOUND', status: 404 });
    });

    it('rejects an origin that is the same as the destination', async () => {
      await expect(
        service.save('user-1', {
          origin: station('가양', '09_907'),
          destination: station('가양역', '09_907'),
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_REQUEST_PAYLOAD', status: 400 });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects with 409 once the user has reached the limit', async () => {
      repo.count.mockResolvedValue(FAVORITE_ROUTE_LIMIT);

      await expect(
        service.save('user-1', {
          origin: station('가양', '09_907'),
          destination: station('신논현', '09_925'),
        }),
      ).rejects.toMatchObject({ errorCode: 'FAVORITE_ROUTE_LIMIT', status: 409 });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('still returns an existing favorite when the user is at the limit', async () => {
      repo.count.mockResolvedValue(FAVORITE_ROUTE_LIMIT);
      repo.findByKey.mockResolvedValue(saved('fav-9', '09_907', '09_925'));

      await expect(
        service.save('user-1', {
          origin: station('가양', '09_907'),
          destination: station('신논현', '09_925'),
        }),
      ).resolves.toMatchObject({ alreadySaved: true });
    });
  });

  describe('remove', () => {
    it('reports removed true for the user own favorite', async () => {
      await expect(service.remove('user-1', 'fav-1')).resolves.toEqual({
        id: 'fav-1',
        removed: true,
      });
      expect(repo.remove).toHaveBeenCalledWith('user-1', 'fav-1');
    });

    it('reports removed false when there was nothing to remove', async () => {
      repo.remove.mockResolvedValue(false);

      await expect(service.remove('user-1', 'fav-x')).resolves.toEqual({
        id: 'fav-x',
        removed: false,
      });
    });
  });
});
