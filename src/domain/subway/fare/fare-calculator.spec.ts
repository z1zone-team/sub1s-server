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

describe('calculateFare (separate fare lines)', () => {
  const ride = (lineId: string, from: string, to: string) => ({
    lineId,
    fromStationId: from,
    toStationId: to,
  });

  it('adds the flat Uijeongbu surcharge only when the line is ridden', () => {
    expect(calculateFare(8, rule, [ride('02', '02_a', '02_b')])).toBe(1550);
    expect(calculateFare(8, rule, [ride('UJ', 'UJ_U110', 'UJ_U111')])).toBe(
      1750,
    );
  });

  it.each([
    ['신사-강남', [['SB_D4', 'SB_D5']], 700],
    ['강남-정자', [['SB_D7', 'SB_D8']], 1000],
    ['정자-광교', [['SB_D12', 'SB_D13']], 1000],
    [
      '강남-광교',
      [
        ['SB_D11', 'SB_D12'],
        ['SB_D12', 'SB_D13'],
      ],
      1500,
    ],
    [
      '신사-정자',
      [
        ['SB_D6', 'SB_D7'],
        ['SB_D7', 'SB_D8'],
      ],
      1700,
    ],
    [
      '신사-광교',
      [
        ['SB_D6', 'SB_D7'],
        ['SB_D7', 'SB_D8'],
        ['SB_D12', 'SB_D13'],
      ],
      2200,
    ],
  ])('adds the Shinbundang surcharge for %s', (_name, pairs, surcharge) => {
    const edges = pairs.map(([from, to]) => ride('SB', from, to));
    expect(calculateFare(8, rule, edges)).toBe(1550 + surcharge);
  });

  it('combines the distance fare and the surcharge', () => {
    const edges = [ride('SB', 'SB_D7', 'SB_D8')];
    expect(calculateFare(15.1, rule, edges)).toBe(1750 + 1000);
  });

  it('rejects an edge that is not inside any defined segment', () => {
    expect(() =>
      calculateFare(8, rule, [ride('SB', 'SB_D4', 'SB_D12')]),
    ).toThrow('fare segment');
  });
});
