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

describe('calculateFare (GTX-A, official examples)', () => {
  const ga = (from: string, to: string, distanceKm: number) => ({
    lineId: 'GA',
    fromStationId: from,
    toStationId: to,
    distanceKm,
  });

  it.each([
    [
      '수서~동탄 32.8km',
      [ga('a', 'b', 10.6), ga('b', 'c', 11), ga('c', 'd', 11.2)],
      4450,
    ],
    ['수서~성남 10.6km', [ga('a', 'b', 10.6)], 3450],
    ['10km 이내', [ga('a', 'b', 8)], 3200],
  ])('weekday %s costs %p won', (_name, edges, expected) => {
    const distance = edges.reduce((sum, e) => sum + e.distanceKm, 0);
    expect(calculateFare(distance, rule, edges)).toBe(expected);
  });

  it('uses the weekend base fare', () => {
    const edges = [ga('a', 'b', 8)];
    expect(calculateFare(8, rule, edges, { weekend: true })).toBe(2850);
  });

  it('charges no extra when transferring to a subway line (동탄 -> 수서 -> 일원)', () => {
    const edges = [
      ga('a', 'b', 10.6),
      ga('b', 'c', 11),
      ga('c', 'd', 11.2),
      { lineId: '03', fromStationId: 'x', toStationId: 'y', distanceKm: 1.9 },
    ];
    expect(calculateFare(34.7, rule, edges)).toBe(4450);
  });

  it('requires the ridden distance', () => {
    expect(() =>
      calculateFare(8, rule, [
        { lineId: 'GA', fromStationId: 'a', toStationId: 'b' },
      ]),
    ).toThrow('distanceKm');
  });
});

describe('calculateFare (AREX, official fare table)', () => {
  const stations = JSON.parse(
    readFileSync(
      join(__dirname, '../../../data/subway/stations.json'),
      'utf-8',
    ),
  ) as { id: string; lineId: string; lineSeq: number; stationName: string }[];
  const arStations = stations
    .filter((s) => s.lineId === 'AR')
    .sort((a, b) => a.lineSeq - b.lineSeq);
  const idOf = (name: string) => {
    const found = arStations.find((s) => s.stationName === name);
    if (!found) throw new Error(`no AR station ${name}`);
    return found.id;
  };
  const ride = (from: string, to: string) => {
    const a = arStations.findIndex((s) => s.stationName === from);
    const b = arStations.findIndex((s) => s.stationName === to);
    const step = a < b ? 1 : -1;
    const edges = [];
    for (let i = a; i !== b; i += step) {
      edges.push({
        lineId: 'AR',
        fromStationId: arStations[i].id,
        toStationId: arStations[i + step].id,
        distanceKm: 3,
      });
    }
    return edges;
  };

  it.each([
    ['서울역', '인천공항1터미널', 4750],
    ['서울역', '인천공항2터미널', 5350],
    ['서울역', '영종', 3350],
    ['영종', '인천공항2터미널', 1900],
    ['검암', '인천공항2터미널', 3800],
    ['청라국제도시', '영종', 1200],
    ['공덕', '홍대입구', 1550],
  ])('%s -> %s costs %p won', (from, to, expected) => {
    expect(calculateFare(10, rule, ride(from, to))).toBe(expected);
    expect(calculateFare(10, rule, ride(to, from))).toBe(expected);
  });

  it('adds the independent zone fare to the integrated fare on a mixed trip', () => {
    const edges = [
      { lineId: '02', fromStationId: 'p', toStationId: 'q', distanceKm: 12 },
      ...ride('홍대입구', '청라국제도시').map((e) => ({
        ...e,
        distanceKm: 20,
      })),
      {
        lineId: 'AR',
        fromStationId: idOf('청라국제도시'),
        toStationId: idOf('영종'),
        distanceKm: 8,
      },
    ];
    const total = 12 + 20 * 5 + 8;
    expect(calculateFare(total, rule, edges)).toBe(
      calculateFare(total - 8, rule) + 1200,
    );
  });
});
