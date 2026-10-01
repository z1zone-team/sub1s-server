import { join } from 'path';
import { FareRule } from '../../domain/subway/fare/fare-calculator';
import {
  GraphData,
  SubwayGraph,
} from '../../domain/subway/models/subway-graph';
import { RouteMode } from '../../domain/subway/models/route';
import { OUT_DIR, readJson } from '../../scripts/lib/subway-common';
import {
  CongestionData,
  StatisticalCongestionProvider,
} from '../congestion/statistical-congestion.provider';
import { AStarRouteEngine } from './astar-route.engine';
import { DijkstraRouteEngine } from './dijkstra-route.engine';

// The heuristic is only valid if A* never returns a more expensive route than Dijkstra. This checks it on
// the real network for random station pairs in every mode, with the published congestion statistics.
describe('AStarRouteEngine on the refined subway data', () => {
  const graph = new SubwayGraph({
    stations: readJson(join(OUT_DIR, 'stations.json')),
    edges: readJson(join(OUT_DIR, 'edges.json')),
    transfers: readJson(join(OUT_DIR, 'transfers.json')),
  } as GraphData);
  const fareRule = readJson<FareRule>(join(OUT_DIR, 'fare-rules.json'));
  const congestion = new StatisticalCongestionProvider(
    readJson<CongestionData>(join(OUT_DIR, 'congestion.json')),
  );
  const source = { getGraph: () => graph };
  const dijkstra = new DijkstraRouteEngine(source, congestion, fareRule);
  const astar = new AStarRouteEngine(source, congestion, fareRule);
  const departureAt = new Date('2026-10-05T08:00:00+09:00');

  // fixed pseudo-random pairs so that a failure can be reproduced
  const pairs: [string, string][] = [];
  let seed = 20261001;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 150; i += 1) {
    const a = graph.station(Math.floor(next() * graph.stationCount)).id;
    const b = graph.station(Math.floor(next() * graph.stationCount)).id;
    if (a !== b) pairs.push([a, b]);
  }

  const modes: RouteMode[] = ['OPTIMAL', 'COMFORTABLE', 'CHEAPEST'];

  it.each(modes)('finds the same weighted cost as Dijkstra for %s', (mode) => {
    let compared = 0;
    for (const [origin, destination] of pairs) {
      const query = {
        originStationId: origin,
        destinationStationId: destination,
        mode,
        departureAt,
      };
      let expected;
      try {
        expected = dijkstra.findRouteWithStatsSync(query);
      } catch (error) {
        // no route: A* must agree
        let astarError: unknown;
        try {
          astar.findRouteWithStatsSync(query);
        } catch (thrown) {
          astarError = thrown;
        }
        expect((astarError as Error | undefined)?.constructor).toBe(
          (error as Error).constructor,
        );
        continue;
      }
      const actual = astar.findRouteWithStatsSync(query);

      expect(actual.stats.cost).toBeCloseTo(expected.stats.cost, 6);
      if (mode === 'CHEAPEST') {
        expect(actual.result.totalFare).toBe(expected.result.totalFare);
      }
      compared += 1;
    }
    expect(compared).toBeGreaterThan(30);
  });

  it('expands fewer stations than Dijkstra on average', () => {
    let dijkstraVisited = 0;
    let astarVisited = 0;
    for (const [origin, destination] of pairs) {
      const query = {
        originStationId: origin,
        destinationStationId: destination,
        mode: 'OPTIMAL' as const,
        departureAt,
      };
      try {
        dijkstraVisited +=
          dijkstra.findRouteWithStatsSync(query).stats.visitedNodes;
        astarVisited += astar.findRouteWithStatsSync(query).stats.visitedNodes;
      } catch {
        // no route between this pair
      }
    }

    expect(astarVisited).toBeLessThan(dijkstraVisited);
  });
});
