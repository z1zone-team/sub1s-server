import { IUserPlaceRepository } from '../../domain/user/ports/IUserPlaceRepository';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { UserPlaceService } from './user-place.service';

describe('UserPlaceService', () => {
  let repo: jest.Mocked<IUserPlaceRepository>;
  let graph: { getGraph: jest.Mock };
  let service: UserPlaceService;

  beforeEach(() => {
    repo = {
      findAll: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation(async (_userId, kind, place) => ({ kind, ...place })),
      remove: jest.fn().mockResolvedValue(true),
    };
    graph = { getGraph: jest.fn().mockReturnValue({ indexOf: (id: string) => (id === '09_907' ? 3 : undefined) }) };
    service = new UserPlaceService(repo, graph as unknown as SubwayGraphService);
  });

  it('lists the saved places', async () => {
    const places = [{ kind: 'HOME', name: '가양역', stationId: '09_907', lat: null, lng: null }];
    repo.findAll.mockResolvedValue(places as never);

    await expect(service.list('user-1')).resolves.toEqual({ places });
  });

  it('saves a station place without coordinates', async () => {
    const result = await service.save('user-1', 'HOME', { name: '가양역', stationId: '09_907' });

    expect(repo.save).toHaveBeenCalledWith('user-1', 'HOME', {
      name: '가양역',
      stationId: '09_907',
      lat: null,
      lng: null,
    });
    expect(result).toMatchObject({ kind: 'HOME', stationId: '09_907' });
  });

  it('saves a coordinate place without a station', async () => {
    await service.save('user-1', 'SCHOOL', { name: '학교', lat: 37.5, lng: 127.1 });

    expect(repo.save).toHaveBeenCalledWith('user-1', 'SCHOOL', {
      name: '학교',
      stationId: null,
      lat: 37.5,
      lng: 127.1,
    });
  });

  it('prefers the station when both are sent', async () => {
    await service.save('user-1', 'HOME', { name: '가양역', stationId: '09_907', lat: 37.5, lng: 127.1 });

    expect(repo.save).toHaveBeenCalledWith('user-1', 'HOME', expect.objectContaining({ stationId: '09_907', lat: null, lng: null }));
  });

  it('rejects a place with neither a station nor coordinates', async () => {
    await expect(service.save('user-1', 'HOME', { name: '집' })).rejects.toMatchObject({
      errorCode: 'INVALID_REQUEST_PAYLOAD',
    });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects a station that does not exist', async () => {
    await expect(service.save('user-1', 'HOME', { name: '없는역', stationId: 'nope' })).rejects.toMatchObject({
      errorCode: 'STATION_NOT_FOUND',
    });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('reports whether anything was removed', async () => {
    await expect(service.remove('user-1', 'HOME')).resolves.toEqual({ kind: 'HOME', removed: true });
    repo.remove.mockResolvedValue(false);
    await expect(service.remove('user-1', 'SCHOOL')).resolves.toEqual({ kind: 'SCHOOL', removed: false });
  });
});
