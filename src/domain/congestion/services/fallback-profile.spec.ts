import { buildFallbackProfile, fallbackProfileRate } from './fallback-profile';

const record = (
  stationId: string,
  dayType: 'WEEKDAY' | 'SATURDAY' | 'SUNDAY',
  rates: number[],
) => ({ stationId, dayType, rates });

describe('buildFallbackProfile', () => {
  it('averages the records of a day type slot by slot', () => {
    const profile = buildFallbackProfile([
      record('02_1', 'WEEKDAY', [10, 20]),
      record('02_2', 'WEEKDAY', [30, 60]),
      record('02_1', 'SATURDAY', [5, 15]),
    ]);

    expect(profile.rates.WEEKDAY).toEqual([20, 40]);
    expect(profile.rates.SATURDAY).toEqual([5, 15]);
  });

  it('ignores values that are not finite', () => {
    const profile = buildFallbackProfile([
      record('02_1', 'WEEKDAY', [10, NaN]),
      record('02_2', 'WEEKDAY', [30, 40]),
    ]);

    expect(profile.rates.WEEKDAY).toEqual([20, 40]);
  });

  it('has no curve for a day type without records', () => {
    const profile = buildFallbackProfile([record('02_1', 'WEEKDAY', [10])]);

    expect(profile.rates.SUNDAY).toBeUndefined();
    expect(fallbackProfileRate(profile, '02', 'SUNDAY', 0)).toBeUndefined();
  });

  it('has no value for a slot nobody has data for', () => {
    const profile = buildFallbackProfile([
      record('02_1', 'WEEKDAY', [10, NaN]),
    ]);

    expect(fallbackProfileRate(profile, '02', 'WEEKDAY', 1)).toBeUndefined();
    expect(fallbackProfileRate(profile, '02', 'WEEKDAY', 5)).toBeUndefined();
  });

  it('averages the line coefficients of the records', () => {
    // 02 is 1.3 and 06 is 0.75
    const profile = buildFallbackProfile([
      record('02_1', 'WEEKDAY', [40]),
      record('06_1', 'WEEKDAY', [40]),
    ]);

    expect(profile.meanBaseRate).toBeCloseTo(1.025);
  });

  it('uses 1 as the mean line coefficient when there are no records', () => {
    expect(buildFallbackProfile([]).meanBaseRate).toBe(1);
  });
});

describe('fallbackProfileRate', () => {
  const profile = buildFallbackProfile([
    record('02_1', 'WEEKDAY', [40]),
    record('06_1', 'WEEKDAY', [40]),
  ]);

  it('scales the average curve by the line coefficient over the mean coefficient', () => {
    expect(fallbackProfileRate(profile, '02', 'WEEKDAY', 0)).toBeCloseTo(
      (40 * 1.3) / 1.025,
    );
    expect(fallbackProfileRate(profile, '06', 'WEEKDAY', 0)).toBeCloseTo(
      (40 * 0.75) / 1.025,
    );
    // a line with no coefficient of its own gets the default 0.75
    expect(fallbackProfileRate(profile, 'GJ', 'WEEKDAY', 0)).toBeCloseTo(
      (40 * 0.75) / 1.025,
    );
  });

  it('returns the average itself for a line at the mean coefficient', () => {
    const flat = buildFallbackProfile([record('01_1', 'WEEKDAY', [40])]);

    expect(fallbackProfileRate(flat, '01', 'WEEKDAY', 0)).toBeCloseTo(40);
  });

  it('never exceeds 100', () => {
    const low = buildFallbackProfile([record('06_1', 'WEEKDAY', [90])]);

    // 90 x 1.3 / 0.75 = 156
    expect(fallbackProfileRate(low, '02', 'WEEKDAY', 0)).toBe(100);
  });

  it('is the same for the same input (no noise)', () => {
    expect(fallbackProfileRate(profile, '02', 'WEEKDAY', 0)).toBe(
      fallbackProfileRate(profile, '02', 'WEEKDAY', 0),
    );
  });
});
