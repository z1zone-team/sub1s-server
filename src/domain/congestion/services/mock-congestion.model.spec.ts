import { baseRate, mockStationRate, peakFactor } from './mock-congestion.model';

const at = (hour: number, minute = 0): number => hour * 60 + minute;

describe('baseRate', () => {
  it('follows the ADR-005 line coefficients', () => {
    expect(baseRate('02')).toBe(1.3);
    expect(baseRate('09')).toBe(1.3);
    expect(baseRate('03')).toBe(1.05);
    expect(baseRate('07')).toBe(1.05);
    expect(baseRate('SB')).toBe(1.05);
    expect(baseRate('01')).toBe(1.0);
    expect(baseRate('05')).toBe(1.0);
    expect(baseRate('06')).toBe(0.75);
    expect(baseRate('GJ')).toBe(0.75);
  });
});

describe('peakFactor', () => {
  it('uses the middle of each ADR-005 range on weekdays', () => {
    expect(peakFactor(at(3), 'WEEKDAY')).toBeCloseTo(0.35); // night
    expect(peakFactor(at(8), 'WEEKDAY')).toBeCloseTo(2.1); // morning peak
    expect(peakFactor(at(14), 'WEEKDAY')).toBeCloseTo(0.95); // daytime
    expect(peakFactor(at(18, 45), 'WEEKDAY')).toBeCloseTo(1.925); // evening peak
    expect(peakFactor(at(23, 30), 'WEEKDAY')).toBeCloseTo(0.35);
  });

  it('rises and falls in a straight line between the periods', () => {
    // halfway between 06:30 (0.35) and 07:30 (2.10)
    expect(peakFactor(at(7), 'WEEKDAY')).toBeCloseTo(1.225);
    // halfway between 09:00 (2.10) and 10:00 (0.95)
    expect(peakFactor(at(9, 30), 'WEEKDAY')).toBeCloseTo(1.525);
  });

  it('keeps the night factor after midnight', () => {
    expect(peakFactor(at(24, 30), 'WEEKDAY')).toBeCloseTo(0.35);
    expect(peakFactor(at(27), 'WEEKDAY')).toBeCloseTo(0.35);
  });

  it('flattens the commuter peaks on weekends', () => {
    expect(peakFactor(at(8), 'SATURDAY')).toBeCloseTo(1.05);
    expect(peakFactor(at(18, 45), 'SUNDAY')).toBeCloseTo(1.05);
    expect(peakFactor(at(14), 'SATURDAY')).toBeCloseTo(0.95);
    expect(peakFactor(at(3), 'SUNDAY')).toBeCloseTo(0.35);
  });
});

describe('mockStationRate', () => {
  it('multiplies the base congestion, line coefficient and peak factor', () => {
    // 35 x 1.0 x 2.10 = 73.5
    expect(mockStationRate('01', at(8), 'WEEKDAY')).toBeCloseTo(73.5);
    // 35 x 0.75 x 0.95
    expect(mockStationRate('06', at(14), 'WEEKDAY')).toBeCloseTo(24.9375);
  });

  it('is higher at the morning peak than at night and never exceeds 100', () => {
    expect(mockStationRate('02', at(8), 'WEEKDAY')).toBeGreaterThan(
      mockStationRate('02', at(3), 'WEEKDAY'),
    );
    expect(mockStationRate('02', at(8), 'WEEKDAY')).toBeLessThanOrEqual(100);
  });

  it('is the same for the same input (no noise)', () => {
    expect(mockStationRate('09', at(18), 'WEEKDAY')).toBe(
      mockStationRate('09', at(18), 'WEEKDAY'),
    );
  });
});
