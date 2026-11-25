import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { FAVORITE_PLACE_LIMIT } from '../../domain/user/models/favorite-place';
import { IFavoritePlaceRepository } from '../../domain/user/ports/IFavoritePlaceRepository';
import { FavoritePlaceService } from './favorite-place.service';

describe('FavoritePlaceService', () => {
  let repo: jest.Mocked<IFavoritePlaceRepository>;
  let service: FavoritePlaceService;
  const known = new Set(['09_907', '02_222']);
  const now = new Date('2026-11-26T00:00:00Z');

  beforeEach(() => {
    repo = {
      findAll: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findByKey: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async (_userId, place) => ({
        id: 'place-1',
        name: place.name,
        stationId: place.stationId,
        lat: place.lat,
        lng: place.lng,
        createdAt: now,
      })),
      remove: jest.fn().mockResolvedValue(true),
    };
    const graph = {
      getGraph: () => ({
        indexOf: (id: string) => (known.has(id) ? 1 : undefined),
      }),
    };
    service = new FavoritePlaceService(
      repo,
      graph as unknown as SubwayGraphService,
    );
  });

  it('lists the places with the limit and a KST time', async () => {
    repo.findAll.mockResolvedValueOnce([
      {
        id: 'p1',
        name: '가양역',
        stationId: '09_907',
        lat: null,
        lng: null,
        createdAt: now,
      },
    ]);

    const result = await service.list('user-1');

    expect(result.limit).toBe(FAVORITE_PLACE_LIMIT);
    expect(result.places).toEqual([
      {
        id: 'p1',
        name: '가양역',
        stationId: '09_907',
        lat: null,
        lng: null,
        createdAt: '2026-11-26T09:00:00.000+09:00',
      },
    ]);
  });

  it('saves a station with its key', async () => {
    const result = await service.save('user-1', {
      name: '가양역',
      stationId: '09_907',
    });

    expect(repo.create).toHaveBeenCalledWith('user-1', {
      name: '가양역',
      stationId: '09_907',
      lat: null,
      lng: null,
      placeKey: 'S:09_907',
    });
    expect(result.alreadySaved).toBe(false);
  });

  it('saves a place by coordinates rounded to four decimals for the key', async () => {
    await service.save('user-1', {
      name: '서울시청',
      lat: 37.56650001,
      lng: 126.978,
    });

    expect(repo.create).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        stationId: null,
        lat: 37.56650001,
        lng: 126.978,
        placeKey: 'P:37.5665,126.9780',
      }),
    );
  });

  it('returns the existing place instead of creating a duplicate, even at the limit', async () => {
    repo.count.mockResolvedValue(FAVORITE_PLACE_LIMIT);
    repo.findByKey.mockResolvedValueOnce({
      id: 'p1',
      name: '가양',
      stationId: '09_907',
      lat: null,
      lng: null,
      createdAt: now,
    });

    const result = await service.save('user-1', {
      name: '가양역',
      stationId: '09_907',
    });

    expect(result).toMatchObject({ id: 'p1', alreadySaved: true });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects with 409 once the user has reached the limit', async () => {
    repo.count.mockResolvedValueOnce(FAVORITE_PLACE_LIMIT);

    await expect(
      service.save('user-1', { name: '가양역', stationId: '09_907' }),
    ).rejects.toMatchObject({ errorCode: 'FAVORITE_PLACE_LIMIT', status: 409 });
  });

  it('rejects a place with neither a station nor coordinates', async () => {
    await expect(
      service.save('user-1', { name: '어딘가' }),
    ).rejects.toMatchObject({
      errorCode: 'INVALID_REQUEST_PAYLOAD',
      status: 400,
    });
  });

  it('answers 404 for a station that does not exist', async () => {
    await expect(
      service.save('user-1', { name: '없는역', stationId: '99_999' }),
    ).rejects.toMatchObject({ errorCode: 'STATION_NOT_FOUND', status: 404 });
  });

  it('reports whether a place was removed', async () => {
    await expect(service.remove('user-1', 'p1')).resolves.toEqual({
      id: 'p1',
      removed: true,
    });
    repo.remove.mockResolvedValueOnce(false);
    await expect(service.remove('user-1', 'p2')).resolves.toEqual({
      id: 'p2',
      removed: false,
    });
  });
});
