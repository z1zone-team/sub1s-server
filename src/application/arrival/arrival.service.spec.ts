import { HttpStatus } from '@nestjs/common';
import {
  INextTrainProvider,
  NextTrain,
} from '../../domain/arrival/ports/INextTrainProvider';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { ArrivalService } from './arrival.service';

describe('ArrivalService', () => {
  const observedAt = new Date('2026-10-11T03:00:00Z');
  const train = (over: Partial<NextTrain> = {}): NextTrain => ({
    direction: 'UP',
    headsign: '개화',
    arrivalInSec: 120,
    message: '2분 후',
    isExpress: false,
    ...over,
  });

  let provider: { fetchNextTrains: jest.Mock };
  let service: ArrivalService;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(observedAt.getTime());
    provider = {
      fetchNextTrains: jest.fn().mockResolvedValue({
        source: 'REALTIME',
        status: 'OK',
        observedAt,
        trains: [],
      }),
    };
    const graph = {
      indexOf: (id: string) => (id === '09_925' ? 0 : undefined),
      station: () => ({ id: '09_925', lineId: '09', stationName: '신논현' }),
    };
    service = new ArrivalService(
      provider as unknown as INextTrainProvider,
      { getGraph: () => graph } as unknown as SubwayGraphService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const withTrains = (trains: NextTrain[]) =>
    provider.fetchNextTrains.mockResolvedValue({ source: 'REALTIME', status: 'OK', observedAt, trains });

  it('asks the provider with the line and name of the station', async () => {
    await service.getNextTrains('09_925');

    expect(provider.fetchNextTrains).toHaveBeenCalledWith({
      stationId: '09_925',
      lineId: '09',
      stationName: '신논현',
    });
  });

  it('returns the station, source, KST update time and trains', async () => {
    withTrains([train()]);

    const res = await service.getNextTrains('09_925');

    expect(res).toMatchObject({
      stationId: '09_925',
      stationName: '신논현',
      lineId: '09',
      source: 'REALTIME',
      status: 'OK',
      updatedAt: '2026-10-11T12:00:00.000+09:00',
    });
    expect(res.trains).toHaveLength(1);
  });

  it('subtracts the time passed since the snapshot and never goes below zero', async () => {
    withTrains([train({ arrivalInSec: 120 }), train({ arrivalInSec: 20, headsign: 'B' })]);
    jest.spyOn(Date, 'now').mockReturnValue(observedAt.getTime() + 30_000);

    const res = await service.getNextTrains('09_925');

    expect(res.trains.map((t) => t.arrivalInSec)).toEqual([0, 90]);
  });

  it('sorts by arrival time with unknown times last', async () => {
    withTrains([
      train({ arrivalInSec: null, headsign: 'unknown' }),
      train({ arrivalInSec: 300, headsign: 'late' }),
      train({ arrivalInSec: 60, headsign: 'soon' }),
    ]);

    const res = await service.getNextTrains('09_925', 5);

    expect(res.trains.map((t) => t.headsign)).toEqual(['soon', 'late', 'unknown']);
  });

  it('keeps the nearest trains per direction up to the limit', async () => {
    withTrains([
      train({ direction: 'UP', arrivalInSec: 60 }),
      train({ direction: 'UP', arrivalInSec: 200 }),
      train({ direction: 'UP', arrivalInSec: 400 }),
      train({ direction: 'DOWN', arrivalInSec: 90 }),
    ]);

    const res = await service.getNextTrains('09_925', 2);

    expect(res.trains.map((t) => `${t.direction}:${t.arrivalInSec}`)).toEqual(['UP:60', 'DOWN:90', 'UP:200']);
  });

  it('defaults to two trains per direction', async () => {
    withTrains([60, 120, 180].map((arrivalInSec) => train({ arrivalInSec })));

    expect((await service.getNextTrains('09_925')).trains).toHaveLength(2);
  });

  it('passes the status through for unsupported lines', async () => {
    provider.fetchNextTrains.mockResolvedValue({ source: 'REALTIME', status: 'UNSUPPORTED_LINE', observedAt, trains: [] });

    expect((await service.getNextTrains('09_925')).status).toBe('UNSUPPORTED_LINE');
  });

  it('rejects an unknown station with 404', async () => {
    await expect(service.getNextTrains('99_999')).rejects.toMatchObject({
      errorCode: 'STATION_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    });
    expect(provider.fetchNextTrains).not.toHaveBeenCalled();
  });
});
