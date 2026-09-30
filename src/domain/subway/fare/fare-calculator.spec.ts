import { readFileSync } from 'fs';
import { join } from 'path';
import { FareRule, calculateFare } from './fare-calculator';

const rule = JSON.parse(
  readFileSync(
    join(__dirname, '../../../data/subway/fare-rules.json'),
    'utf-8',
  ),
) as FareRule;

describe('calculateFare (integrated fare rule)', () => {
  it.each([
    [0, 1550],
    [5, 1550],
    [10, 1550],
    [10.1, 1650],
    [15, 1650],
    [15.1, 1750],
    [50, 2350],
    [50.1, 2450],
    [58, 2450],
    [58.1, 2550],
  ])('%p km costs %p won', (distanceKm, expected) => {
    expect(calculateFare(distanceKm, rule)).toBe(expected);
  });

  it('rejects an invalid distance', () => {
    expect(() => calculateFare(-1, rule)).toThrow();
    expect(() => calculateFare(Number.NaN, rule)).toThrow();
  });
});
