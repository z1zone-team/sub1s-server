import { ConfigService } from '@nestjs/config';
import { TrainObservation } from '../../domain/train-position/models/train-observation';
import { ITrainObservationRepository } from '../../domain/train-position/ports/ITrainObservationRepository';
import { ITrainPositionProvider } from '../../domain/train-position/ports/ITrainPositionProvider';
import { TrainServiceAggregator } from './train-service-aggregator';

describe('TrainServiceAggregator', () => {
  const observation = (iso: string): TrainObservation => ({
    lineId: '02',
    trainNo: '1',
    stationName: '강남',
    stationId: '02_222',
    status: 'ARRIVED',
    direction: 'INNER',
    destinationName: '성수',
    isLastTrain: false,
    observedAt: new Date(iso),
  });
  const provider = (source: 'REALTIME' | 'MOCK') => ({ source }) as unknown as ITrainPositionProvider;
  const repo = () => ({
    saveMany: jest.fn(),
    findBetween: jest
      .fn()
      .mockResolvedValue([observation('2026-10-19T05:36:00+09:00'), observation('2026-10-19T22:00:00+09:00')]),
    upsertDaily: jest.fn().mockResolvedValue(undefined),
    deleteObservationsBefore: jest.fn().mockResolvedValue(3),
  });
  const make = (repository: ReturnType<typeof repo>) =>
    new TrainServiceAggregator(
      provider('REALTIME'),
      new ConfigService({}),
      repository as unknown as ITrainObservationRepository,
    );

  const morning = new Date('2026-10-20T05:00:00+09:00');

  it('aggregates the previous service day once and deletes observations older than 30 days', async () => {
    const repository = repo();
    const aggregator = make(repository);

    await aggregator.tick(morning);
    await aggregator.tick(new Date('2026-10-20T09:00:00+09:00'));

    expect(repository.findBetween).toHaveBeenCalledTimes(1);
    const [from, to] = repository.findBetween.mock.calls[0] as [Date, Date];
    expect(from.toISOString()).toBe('2026-10-18T19:00:00.000Z'); // 10/19 04:00 KST
    expect(to.toISOString()).toBe('2026-10-19T19:00:00.000Z'); // 10/20 04:00 KST
    expect(repository.upsertDaily).toHaveBeenCalledWith([
      {
        serviceDate: '2026-10-19',
        stationId: '02_222',
        direction: 'INNER',
        firstSec: 5 * 3600 + 36 * 60,
        lastSec: 22 * 3600,
        samples: 2,
      },
    ]);
    expect((repository.deleteObservationsBefore.mock.calls[0][0] as Date).toISOString()).toBe(
      '2026-09-19T20:00:00.000Z',
    );
  });

  it('waits until 04:30 so the service day has really ended', async () => {
    const repository = repo();

    await make(repository).tick(new Date('2026-10-20T04:10:00+09:00'));

    expect(repository.findBetween).not.toHaveBeenCalled();
  });

  it('aggregates the next day again the following morning', async () => {
    const repository = repo();
    const aggregator = make(repository);

    await aggregator.tick(morning);
    await aggregator.tick(new Date('2026-10-21T05:00:00+09:00'));

    expect(repository.findBetween).toHaveBeenCalledTimes(2);
  });

  it('retries on the next tick when saving fails', async () => {
    const repository = repo();
    repository.upsertDaily.mockRejectedValueOnce(new Error('db down'));
    const aggregator = make(repository);

    await aggregator.tick(morning);
    await aggregator.tick(new Date('2026-10-20T05:10:00+09:00'));

    expect(repository.upsertDaily).toHaveBeenCalledTimes(2);
  });

  it('does nothing without a repository', async () => {
    const aggregator = new TrainServiceAggregator(provider('REALTIME'), new ConfigService({}));

    await expect(aggregator.tick(morning)).resolves.toBeUndefined();
  });
});
