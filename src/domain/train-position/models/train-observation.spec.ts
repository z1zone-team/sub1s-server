import {
  TrainObservation,
  aggregateServiceDay,
  newObservations,
  previousServiceDate,
  serviceDateOf,
  serviceDayWindow,
} from './train-observation';

describe('train-observation', () => {
  describe('serviceDateOf', () => {
    it('belongs to the previous service day before 04:00 KST', () => {
      expect(serviceDateOf(new Date('2026-10-20T00:30:00+09:00'))).toBe('2026-10-19');
      expect(serviceDateOf(new Date('2026-10-20T03:59:00+09:00'))).toBe('2026-10-19');
      expect(serviceDateOf(new Date('2026-10-20T04:00:00+09:00'))).toBe('2026-10-20');
      expect(serviceDateOf(new Date('2026-10-20T23:59:00+09:00'))).toBe('2026-10-20');
    });
  });

  describe('previousServiceDate', () => {
    it('is the service day before the current one, also across a month end', () => {
      expect(previousServiceDate(new Date('2026-10-20T05:00:00+09:00'))).toBe('2026-10-19');
      expect(previousServiceDate(new Date('2026-10-20T02:00:00+09:00'))).toBe('2026-10-18');
      expect(previousServiceDate(new Date('2026-11-01T05:00:00+09:00'))).toBe('2026-10-31');
    });
  });

  describe('serviceDayWindow', () => {
    it('runs from 04:00 to 04:00 the next day', () => {
      const window = serviceDayWindow('2026-10-19');

      expect(new Date(window.from).toISOString()).toBe('2026-10-18T19:00:00.000Z'); // 10/19 04:00 KST
      expect(new Date(window.to).toISOString()).toBe('2026-10-19T19:00:00.000Z'); // 10/20 04:00 KST
    });
  });

  describe('newObservations', () => {
    const train = (trainNo: string, stationName: string, status: 'ARRIVED' | 'DEPARTED') => ({
      trainNo,
      stationName,
      stationId: `02_${stationName}`,
      status,
      direction: 'INNER' as const,
      destinationName: '성수',
      isExpress: false,
      isLastTrain: false,
    });
    const at = new Date('2026-10-19T09:00:00+09:00');

    it('keeps only the trains whose station or status changed since the last one stored', () => {
      const previous = new Map<string, string>();

      const first = newObservations('02', [train('1', '강남', 'ARRIVED'), train('2', '역삼', 'ARRIVED')], at, previous);
      const second = newObservations(
        '02',
        [train('1', '강남', 'ARRIVED'), train('2', '역삼', 'DEPARTED'), train('3', '성수', 'ARRIVED')],
        at,
        previous,
      );

      expect(first.map((o) => o.trainNo)).toEqual(['1', '2']);
      expect(second.map((o) => `${o.trainNo}:${o.status}`)).toEqual(['2:DEPARTED', '3:ARRIVED']);
    });

    it('treats the same train number on another line as a different train', () => {
      const previous = new Map<string, string>();

      newObservations('02', [train('1', '강남', 'ARRIVED')], at, previous);

      expect(newObservations('03', [train('1', '강남', 'ARRIVED')], at, previous)).toHaveLength(1);
    });

    it('skips rows without a train number', () => {
      expect(newObservations('02', [train('', '강남', 'ARRIVED')], at, new Map())).toEqual([]);
    });
  });

  describe('aggregateServiceDay', () => {
    const observation = (over: Partial<TrainObservation>): TrainObservation => ({
      lineId: '02',
      trainNo: '1',
      stationName: '강남',
      stationId: '02_222',
      status: 'ARRIVED',
      direction: 'INNER',
      destinationName: '성수',
      isLastTrain: false,
      observedAt: new Date('2026-10-19T09:00:00+09:00'),
      ...over,
    });

    it('finds the first and last time a train was seen at each station and direction, in service seconds', () => {
      const rows = aggregateServiceDay('2026-10-19', [
        observation({ observedAt: new Date('2026-10-19T05:36:00+09:00') }),
        observation({ observedAt: new Date('2026-10-19T12:00:00+09:00') }),
        observation({ observedAt: new Date('2026-10-20T00:46:00+09:00') }), // 24:46
        observation({ direction: 'OUTER', observedAt: new Date('2026-10-19T05:44:00+09:00') }),
      ]);

      expect(rows).toEqual([
        { serviceDate: '2026-10-19', stationId: '02_222', direction: 'INNER', firstSec: 5 * 3600 + 36 * 60, lastSec: 24 * 3600 + 46 * 60, samples: 3 },
        { serviceDate: '2026-10-19', stationId: '02_222', direction: 'OUTER', firstSec: 5 * 3600 + 44 * 60, lastSec: 5 * 3600 + 44 * 60, samples: 1 },
      ]);
    });

    it('ignores trains between stations and rows without a station id', () => {
      const rows = aggregateServiceDay('2026-10-19', [
        observation({ status: 'LEFT_PREVIOUS' }),
        observation({ status: 'UNKNOWN' }),
        observation({ stationId: null }),
      ]);

      expect(rows).toEqual([]);
    });
  });
});
