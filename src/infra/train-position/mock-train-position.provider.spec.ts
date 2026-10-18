import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { MockTrainPositionProvider } from './mock-train-position.provider';

describe('MockTrainPositionProvider', () => {
  const station = (lineId: string, seq: number, name: string) => ({
    id: `${lineId}_${seq}`,
    lineId,
    stationName: name,
    lat: 37.5,
    lng: 127 + seq / 100,
    lineSeq: seq,
  });
  // 2호선(순환) 12개 역, 9호선 8개 역, 짧은 호선 3개 역
  const graph = new SubwayGraph({
    stations: [
      ...Array.from({ length: 12 }, (_, i) => station('02', i + 1, `L${i + 1}`)),
      ...Array.from({ length: 8 }, (_, i) => station('09', i + 1, `N${i + 1}`)),
      ...Array.from({ length: 3 }, (_, i) => station('XX', i + 1, `S${i + 1}`)),
    ],
    edges: [],
    transfers: [],
  });
  const provider = new MockTrainPositionProvider({ getGraph: () => graph } as unknown as SubwayGraphService);
  const at = (seconds: number) => new Date(seconds * 1000);

  it('supports a line only when it has enough stations', () => {
    expect(provider.supports('02')).toBe(true);
    expect(provider.supports('09')).toBe(true);
    expect(provider.supports('XX')).toBe(false);
    expect(provider.supports('ZZ')).toBe(false);
  });

  it('makes trains in both directions with the loop line called inner and outer', async () => {
    const loop = await provider.fetchLine('02', at(1000));
    const straight = await provider.fetchLine('09', at(1000));

    expect(loop?.source).toBe('MOCK');
    expect(new Set(loop?.trains.map((t) => t.direction))).toEqual(new Set(['INNER', 'OUTER']));
    expect(new Set(straight?.trains.map((t) => t.direction))).toEqual(new Set(['UP', 'DOWN']));
  });

  it('puts every train on a station of that line with a known status', async () => {
    const names = new Set(Array.from({ length: 12 }, (_, i) => `L${i + 1}`));
    const statuses = new Set(['ENTERING', 'ARRIVED', 'DEPARTED', 'LEFT_PREVIOUS']);

    for (const seconds of [0, 45, 100, 777, 5000, 123456]) {
      const result = await provider.fetchLine('02', at(seconds));
      expect(result?.trains.length).toBeGreaterThan(0);
      for (const train of result?.trains ?? []) {
        expect(names.has(train.stationName)).toBe(true);
        expect(statuses.has(train.status)).toBe(true);
      }
    }
  });

  it('gives the same trains for the same time and moves them as time passes', async () => {
    const a = await provider.fetchLine('09', at(1000));
    const b = await provider.fetchLine('09', at(1000));
    const later = await provider.fetchLine('09', at(1000 + 90 * 3));

    expect(a?.trains).toEqual(b?.trains);
    expect(later?.trains).not.toEqual(a?.trains);
  });

  it('gives each train its own number', async () => {
    const result = await provider.fetchLine('09', at(1000));
    const numbers = result?.trains.map((t) => t.trainNo) ?? [];

    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('names the terminal station of a straight line and bounces at the ends', async () => {
    const seen = new Set<string>();
    for (let seconds = 0; seconds < 90 * 40; seconds += 30) {
      const result = await provider.fetchLine('09', at(seconds));
      for (const train of result?.trains ?? []) seen.add(`${train.direction}:${train.destinationName}`);
    }

    // 끝에서 되돌아오므로 같은 열차가 양쪽 방향과 종착역을 모두 거친다
    expect(seen.has('DOWN:N8')).toBe(true);
    expect(seen.has('UP:N1')).toBe(true);
  });

  it('returns null for a line it cannot make', async () => {
    expect(await provider.fetchLine('XX', at(1000))).toBeNull();
  });
});
