import { join } from 'path';
import { FareRule } from '../../domain/subway/fare/fare-calculator';
import { RouteQuery } from '../../domain/subway/models/route';
import {
  GraphData,
  SubwayGraph,
} from '../../domain/subway/models/subway-graph';
import { OUT_DIR, readJson } from '../../scripts/lib/subway-common';
import {
  CongestionData,
  StatisticalCongestionProvider,
} from '../congestion/statistical-congestion.provider';
import { AStarRouteEngine } from './astar-route.engine';
import { DijkstraRouteEngine } from './dijkstra-route.engine';
import { MultiCriteriaRouteEngine } from './multi-criteria-route.engine';

// Dijkstra versus A* on the real network (ADR-001 section 4). Run with `pnpm test:benchmark`; it is not part of
// `pnpm test` because it takes a while and prints numbers instead of checking behavior.
// Query classes follow the ADR: short trips of 5 stations or fewer and long trips of 15 stations or more.
const REPEAT = 500;
const WARM_UP = 50;
const QUERIES_PER_CLASS = 40;
const ALLOCATION_SAMPLE = 300;

jest.setTimeout(10 * 60 * 1000);

interface Row {
  engine: string;
  queryClass: string;
  mode: string;
  queries: number;
  avgMs: number;
  avgVisited: number;
  avgRelaxed: number;
  heapKbPerQuery: number | string;
}

describe('routing benchmark: Dijkstra vs A*', () => {
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
  const engines: [string, MultiCriteriaRouteEngine][] = [
    ['Dijkstra', new DijkstraRouteEngine(source, congestion, fareRule)],
    ['A*', new AStarRouteEngine(source, congestion, fareRule)],
  ];
  const departureAt = new Date('2026-10-05T08:00:00+09:00');

  // pick pairs by how many stations the cheapest route rides
  function queryClass(
    label: string,
    accept: (stations: number) => boolean,
  ): RouteQuery[] {
    const reference = engines[0][1];
    const picked: RouteQuery[] = [];
    let seed = label.length * 7919;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let attempt = 0; attempt < 20000; attempt += 1) {
      if (picked.length === QUERIES_PER_CLASS) break;
      const a = graph.station(Math.floor(next() * graph.stationCount)).id;
      const b = graph.station(Math.floor(next() * graph.stationCount)).id;
      if (a === b) continue;
      const query: RouteQuery = {
        originStationId: a,
        destinationStationId: b,
        mode: 'OPTIMAL',
        departureAt,
      };
      try {
        const rides = reference
          .findRouteWithStatsSync(query)
          .result.segments.reduce((sum, s) => sum + s.stationCount, 0);
        if (accept(rides)) picked.push(query);
      } catch {
        // not connected
      }
    }
    return picked;
  }

  const classes: [string, RouteQuery[]][] = [
    ['short (<= 5 stations)', queryClass('short', (n) => n >= 1 && n <= 5)],
    ['long (>= 15 stations)', queryClass('long', (n) => n >= 15)],
  ];
  classes.push(['all', classes.flatMap(([, queries]) => queries)]);

  const rows: Row[] = [];

  afterAll(() => {
    console.log(
      `\nRouting benchmark: ${graph.stationCount} stations, ${REPEAT} repetitions of each query set, ` +
        `departure ${departureAt.toISOString()}\n` +
        'heapKbPerQuery is the heap growth without garbage collection (an allocation indicator)\n',
    );
    console.table(rows);
  });

  for (const mode of ['OPTIMAL', 'COMFORTABLE'] as const) {
    describe(`${mode} mode`, () => {
      it.each(classes)('%s', (label, queries) => {
        expect(queries.length).toBeGreaterThan(5);
        const withMode = queries.map((q) => ({ ...q, mode }));

        // both engines must find the same cost for every query
        for (const query of withMode) {
          const [, dijkstra] = engines[0];
          const [, astar] = engines[1];
          expect(astar.findRouteWithStatsSync(query).stats.cost).toBeCloseTo(
            dijkstra.findRouteWithStatsSync(query).stats.cost,
            6,
          );
        }

        for (const [name, engine] of engines) {
          for (let i = 0; i < WARM_UP; i += 1) {
            for (const query of withMode) engine.findRouteWithStatsSync(query);
          }

          let visited = 0;
          let relaxed = 0;
          for (const query of withMode) {
            const { stats } = engine.findRouteWithStatsSync(query);
            visited += stats.visitedNodes;
            relaxed += stats.relaxedEdges;
          }

          const started = process.hrtime.bigint();
          for (let r = 0; r < REPEAT; r += 1) {
            for (const query of withMode) engine.findRouteWithStatsSync(query);
          }
          const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

          let heapKbPerQuery: number | string = 'n/a (run with --expose-gc)';
          if (global.gc) {
            global.gc();
            const before = process.memoryUsage().heapUsed;
            for (let i = 0; i < ALLOCATION_SAMPLE; i += 1) {
              engine.findRouteWithStatsSync(withMode[i % withMode.length]);
            }
            const after = process.memoryUsage().heapUsed;
            heapKbPerQuery = Math.round(
              (after - before) / 1024 / ALLOCATION_SAMPLE,
            );
          }

          rows.push({
            engine: name,
            queryClass: label,
            mode,
            queries: withMode.length,
            avgMs: Number((elapsedMs / (REPEAT * withMode.length)).toFixed(4)),
            avgVisited: Number((visited / withMode.length).toFixed(1)),
            avgRelaxed: Number((relaxed / withMode.length).toFixed(1)),
            heapKbPerQuery,
          });
        }
      });
    });
  }
});
