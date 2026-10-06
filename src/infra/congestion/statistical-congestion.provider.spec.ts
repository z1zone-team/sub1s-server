import { mockStationRate } from '../../domain/congestion/services/mock-congestion.model';
import {
  CongestionData,
  StatisticalCongestionProvider,
} from './statistical-congestion.provider';

const SLOTS = 39;
// slot i holds the value i, so the slot that was used can be read from the result
const ramp = (offset = 0): number[] =>
  Array.from({ length: SLOTS }, (_, i) => i + offset);

const kst = (iso: string): number => new Date(`${iso}+09:00`).getTime();

const data: CongestionData = {
  records: [
    { stationId: 'S_1', direction: 'DOWN', dayType: 'WEEKDAY', rates: ramp() },
    {
      stationId: 'S_1',
      direction: 'UP',
      dayType: 'WEEKDAY',
      rates: ramp(100),
    },
    {
      stationId: 'S_1',
      direction: 'DOWN',
      dayType: 'SATURDAY',
      rates: ramp(10),
    },
    {
      stationId: 'B_1',
      direction: 'INNER',
      dayType: 'WEEKDAY',
      rates: ramp(10),
    },
    {
      stationId: 'B_1',
      direction: 'OUTER',
      dayType: 'WEEKDAY',
      rates: ramp(30),
    },
  ],
};

describe('StatisticalCongestionProvider', () => {
  const provider = new StatisticalCongestionProvider(data);
  // Monday 2026-10-05 08:45 is in the 08:30~09:00 slot, which is slot index 6
  const mondayMorning = kst('2026-10-05T08:45:00');

  it('returns the published statistics of the station, direction and slot', () => {
    expect(provider.stationRate('02', 'S_1', 'DOWN', mondayMorning)).toEqual({
      ratePercent: 6,
      source: 'STATISTICS',
    });
    expect(provider.stationRate('02', 'S_1', 'UP', mondayMorning)).toEqual({
      ratePercent: 100, // 106 in the data, capped
      source: 'STATISTICS',
    });
  });

  it('converts to the 0 to 1 scale used by the route search', () => {
    expect(
      provider.getCongestion('02', 'S_1', 'S_2', 'DOWN', mondayMorning),
    ).toBeCloseTo(0.06);
  });

  it('uses the sheet of the day type', () => {
    const saturday = kst('2026-10-10T08:45:00');

    expect(
      provider.stationRate('02', 'S_1', 'DOWN', saturday).ratePercent,
    ).toBe(16);
  });

  it('caps rates above 100 percent', () => {
    expect(
      provider.stationRate('02', 'S_1', 'UP', mondayMorning).ratePercent,
    ).toBe(100);
  });

  it('averages the directions of a station that is listed under other directions', () => {
    // B_1 only has INNER (16) and OUTER (36) at slot 6
    expect(provider.stationRate('02', 'B_1', 'DOWN', mondayMorning)).toEqual({
      ratePercent: 26,
      source: 'STATISTICS',
    });
  });

  it('falls back to the ADR-005 model for stations without statistics', () => {
    const rate = provider.stationRate('SB', 'NO_DATA', 'DOWN', mondayMorning);

    expect(rate.source).toBe('MOCK');
    expect(rate.ratePercent).toBeCloseTo(
      mockStationRate('SB', 8 * 60 + 45, 'WEEKDAY'),
    );
  });

  it('falls back to the model when no statistics exist for the day type', () => {
    const sunday = kst('2026-10-11T08:45:00');

    expect(provider.stationRate('02', 'S_1', 'DOWN', sunday).source).toBe(
      'MOCK',
    );
  });

  it('falls back to the model when no train runs', () => {
    const night = kst('2026-10-05T03:00:00');

    expect(provider.stationRate('02', 'S_1', 'DOWN', night).source).toBe(
      'MOCK',
    );
  });

  it('is deterministic', () => {
    const a = provider.getCongestion('02', 'NO_DATA', 'X', 'UP', mondayMorning);
    const b = provider.getCongestion('02', 'NO_DATA', 'X', 'UP', mondayMorning);

    expect(a).toBe(b);
  });

  it('predicts the cars from the station rate', () => {
    const prediction = provider.predictCars(
      '02',
      'S_1',
      'DOWN',
      mondayMorning,
      [3],
    );

    expect(prediction.source).toBe('STATISTICS');
    expect(prediction.cars).toHaveLength(10);
    expect(prediction.cars[2].rate).toBeCloseTo(6 * 1.425);
    expect(prediction.cars[0].rate).toBeCloseTo(6 * 0.775);
  });
});
