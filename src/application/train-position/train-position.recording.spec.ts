import { ConfigService } from '@nestjs/config';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { LineTrainPositions } from '../../domain/train-position/models/train-position';
import { ITrainObservationRepository } from '../../domain/train-position/ports/ITrainObservationRepository';
import { ITrainPositionProvider } from '../../domain/train-position/ports/ITrainPositionProvider';
import { TrainPositionService } from './train-position.service';

describe('TrainPositionService observation recording', () => {
  const graph = new SubwayGraph({
    stations: [{ id: '02_222', lineId: '02', stationName: '강남', lat: 37.5, lng: 127.02, lineSeq: 1 }],
    edges: [],
    transfers: [],
  });
  const graphService = { getGraph: () => graph } as unknown as SubwayGraphService;
  const noon = new Date('2026-10-18T03:00:00Z'); // KST 12:00

  const lineData = (source: 'REALTIME' | 'MOCK'): LineTrainPositions => ({
    lineId: '02',
    source,
    observedAt: noon,
    trains: [
      {
        trainNo: '1',
        stationName: '강남',
        status: 'ARRIVED',
        direction: 'INNER',
        destinationName: '성수',
        isExpress: false,
        isLastTrain: false,
      },
    ],
  });

  const make = (source: 'REALTIME' | 'MOCK', saveMany: jest.Mock) => {
    const provider = {
      source,
      supports: () => true,
      fetchLine: async () => lineData(source),
    } as unknown as ITrainPositionProvider;
    const repository = { saveMany } as unknown as ITrainObservationRepository;
    return new TrainPositionService(
      provider,
      graphService,
      new ConfigService({ TRAIN_POSITION_ENABLED: 'true' }),
      repository,
    );
  };

  it('saves the changed observations of a real poll once, with the station id', async () => {
    const saveMany = jest.fn().mockResolvedValue(undefined);
    const service = make('REALTIME', saveMany);

    await service.tick(noon);
    await service.tick(noon);

    expect(saveMany).toHaveBeenCalledTimes(2);
    expect(saveMany.mock.calls[0][0]).toMatchObject([
      { lineId: '02', trainNo: '1', stationId: '02_222', status: 'ARRIVED' },
    ]);
    expect(saveMany.mock.calls[1][0]).toEqual([]);
  });

  it('does not save fake trains', async () => {
    const saveMany = jest.fn();

    await make('MOCK', saveMany).tick(noon);

    expect(saveMany).not.toHaveBeenCalled();
  });

  it('keeps polling and serving positions when saving fails', async () => {
    const saveMany = jest.fn().mockRejectedValue(new Error('db down'));
    const service = make('REALTIME', saveMany);

    await service.tick(noon);

    expect(service.getLine('02', noon).status).toBe('OK');
  });
});
