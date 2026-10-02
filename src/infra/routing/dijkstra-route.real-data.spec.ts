import { join } from 'path';
import { FareRule } from '../../domain/subway/fare/fare-calculator';
import {
  GraphData,
  SubwayGraph,
} from '../../domain/subway/models/subway-graph';
import { NoCongestionProvider } from '../../domain/subway/ports/ICongestionProvider';
import { OUT_DIR, readJson } from '../../scripts/lib/subway-common';
import { DijkstraRouteEngine } from './dijkstra-route.engine';

// Regression checks on the real refined data. The expectations come from the ODsay route comparison
// (2026-09-30): same line, same number of stations and the same fare.
describe('DijkstraRouteEngine on the refined subway data', () => {
  const data: GraphData = {
    stations: readJson(join(OUT_DIR, 'stations.json')),
    edges: readJson(join(OUT_DIR, 'edges.json')),
    transfers: readJson(join(OUT_DIR, 'transfers.json')),
  };
  const fareRule = readJson<FareRule>(join(OUT_DIR, 'fare-rules.json'));
  const graph = new SubwayGraph(data);
  const engine = new DijkstraRouteEngine(
    { getGraph: () => graph },
    new NoCongestionProvider(),
    fareRule,
  );

  const route = (
    originStationId: string,
    destinationStationId: string,
    mode: 'OPTIMAL' | 'CHEAPEST' = 'OPTIMAL',
  ) => engine.findRoute({ originStationId, destinationStationId, mode });

  it('rides Line 5 from Gangdong to Macheon directly (7 stations, 1,550 won)', async () => {
    const result = await route('05_548', '05_P555');

    expect(result.segments.map((s) => [s.lineId, s.stationCount])).toEqual([
      ['05', 7],
    ]);
    expect(result.totalFare).toBe(1550);
  });

  it('follows the Line 5 branch from Sangil-dong to Macheon through Gangdong (12 stations, 1,650 won)', async () => {
    const result = await route('05_553', '05_P555');

    expect(result.stationIds).toContain('05_548');
    expect(result.stationIds).toHaveLength(13);
    expect(result.totalFare).toBe(1650);
  });

  it('uses the 6호선 응암순환 in one direction only', async () => {
    const short = await route('06_615', '06_610');
    const long = await route('06_610', '06_615');

    expect(short.segments[0].stationCount).toBe(1);
    expect(long.segments[0].stationCount).toBe(5);
  });

  it('goes from Gwangmyeong to Gasan Digital Complex on Line 1 (3 stations apart)', async () => {
    const result = await route('01_P144-1', '01_P142');

    expect(result.segments.map((s) => [s.lineId, s.stationCount])).toEqual([
      ['01', 3],
    ]);
    expect(result.transferCount).toBe(0);
  });

  it('rides the Gyeongchun line from Cheongnyangni to Pyeongnae-Hopyeong (11 stations, 1,850 won)', async () => {
    const result = await route('GC_P117', 'GC_P128');

    expect(result.segments.map((s) => [s.lineId, s.stationCount])).toEqual([
      ['GC', 11],
    ]);
    expect(result.totalFare).toBe(1850);
  });

  it('prices the Airport Railroad trip from Seoul Station to Incheon Airport T1 at 4,750 won', async () => {
    const result = await route('AR_A01', 'AR_A10');

    expect(result.segments.map((s) => [s.lineId, s.stationCount])).toEqual([
      ['AR', 12],
    ]);
    expect(result.transferCount).toBe(0);
    expect(result.totalFare).toBe(4750);
  });

  it('answers a long trip within a few milliseconds', async () => {
    const started = process.hrtime.bigint();
    await route('AR_A01', 'AR_A10', 'CHEAPEST');
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    expect(elapsedMs).toBeLessThan(100);
  });
});
