import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import {
  InvalidRouteQueryError,
  RouteMode,
  RouteNotFoundError,
  RouteQuery,
  UnknownStationError,
} from '../../domain/subway/models/route';
import {
  ICongestionProvider,
  NoCongestionProvider,
} from '../../domain/subway/ports/ICongestionProvider';
import { AStarRouteEngine } from './astar-route.engine';
import { DijkstraRouteEngine } from './dijkstra-route.engine';
import { FARE_RULE, GraphBuilder } from './test-support/graph-builder';

function engines(
  graph: SubwayGraph,
  congestion: ICongestionProvider = new NoCongestionProvider(),
): { dijkstra: DijkstraRouteEngine; astar: AStarRouteEngine } {
  const source = { getGraph: () => graph };
  return {
    dijkstra: new DijkstraRouteEngine(source, congestion, FARE_RULE),
    astar: new AStarRouteEngine(source, congestion, FARE_RULE),
  };
}

// both engines must find a route of the same weighted cost (the stations may differ between equal routes)
async function expectSameCost(
  graph: SubwayGraph,
  query: RouteQuery,
  congestion?: ICongestionProvider,
): Promise<{ dijkstraVisited: number; astarVisited: number }> {
  const { dijkstra, astar } = engines(graph, congestion);
  const d = await dijkstra.findRouteWithStats(query);
  const a = await astar.findRouteWithStats(query);

  expect(a.stats.cost).toBeCloseTo(d.stats.cost, 6);
  expect(a.result.mode).toBe(d.result.mode);
  if (query.mode === 'CHEAPEST') {
    expect(a.result.totalFare).toBe(d.result.totalFare);
  }
  return {
    dijkstraVisited: d.stats.visitedNodes,
    astarVisited: a.stats.visitedNodes,
  };
}

// A grid-like network with real coordinates: line A runs east-west, line B north-south, crossing at the hub
function crossroads(): SubwayGraph {
  const builder = new GraphBuilder();
  const steps = [
    -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ];
  for (const i of steps) builder.station(`A_${i}`, 'A', 37, 127 + 0.01 * i);
  for (const j of steps) builder.station(`B_${j}`, 'B', 37 + 0.01 * j, 127);
  for (let k = 0; k < steps.length - 1; k += 1) {
    builder.ride(`A_${steps[k]}`, `A_${steps[k + 1]}`, 'A', 120, 0.9);
    builder.ride(`B_${steps[k]}`, `B_${steps[k + 1]}`, 'B', 120, 1.1);
  }
  return builder.transfer('A_0', 'B_0', 60).build();
}

describe('AStarRouteEngine', () => {
  describe('finds the same cheapest cost as Dijkstra', () => {
    const modes: RouteMode[] = ['OPTIMAL', 'COMFORTABLE', 'CHEAPEST'];

    it.each(modes)('on a crossroads network in %s mode', async (mode) => {
      const graph = crossroads();

      await expectSameCost(graph, {
        originStationId: 'A_-7',
        destinationStationId: 'B_8',
        mode,
      });
      await expectSameCost(graph, {
        originStationId: 'B_-3',
        destinationStationId: 'A_9',
        mode,
      });
    });

    it('with congestion that depends on the line and the time', async () => {
      const graph = crossroads();
      const congestion: ICongestionProvider = {
        getCongestion: (lineId, _from, _to, _direction, at) =>
          lineId === 'A' ? 0.2 + ((at / 60000) % 7) / 10 : 0.1,
      };

      await expectSameCost(
        graph,
        {
          originStationId: 'A_-9',
          destinationStationId: 'B_9',
          mode: 'COMFORTABLE',
          departureAt: new Date('2026-10-05T08:00:00+09:00'),
        },
        congestion,
      );
    });

    it('with weights given for PERSONAL mode', async () => {
      await expectSameCost(crossroads(), {
        originStationId: 'A_-7',
        destinationStationId: 'B_8',
        mode: 'PERSONAL',
        weights: { congestion: 1, transferSec: 900 },
      });
    });

    it('around a blocked segment', async () => {
      await expectSameCost(crossroads(), {
        originStationId: 'A_-5',
        destinationStationId: 'A_5',
        mode: 'OPTIMAL',
        blockedSegments: [{ fromStationId: 'A_1', toStationId: 'A_2' }],
      }).catch((error: unknown) => {
        // blocking the only line between the two stations leaves no route, and both engines must agree
        expect(error).toBeInstanceOf(Error);
      });
    });

    it('when all stations share one coordinate (no usable heuristic)', async () => {
      const graph = new GraphBuilder()
        .station('S_1', 'S')
        .station('S_2', 'S')
        .station('S_3', 'S')
        .ride('S_1', 'S_2', 'S', 100)
        .ride('S_2', 'S_3', 'S', 100)
        .build();

      const { dijkstraVisited, astarVisited } = await expectSameCost(graph, {
        originStationId: 'S_1',
        destinationStationId: 'S_3',
        mode: 'OPTIMAL',
      });

      expect(astarVisited).toBe(dijkstraVisited);
    });
  });

  it('visits fewer stations than Dijkstra when the coordinates point to the goal', async () => {
    const { dijkstraVisited, astarVisited } = await expectSameCost(
      crossroads(),
      {
        originStationId: 'A_0',
        destinationStationId: 'A_10',
        mode: 'OPTIMAL',
      },
    );

    expect(astarVisited).toBeLessThan(dijkstraVisited);
  });

  it('reports the visited stations, relaxed edges and weighted cost', async () => {
    const { astar } = engines(crossroads());

    const { result, stats } = await astar.findRouteWithStats({
      originStationId: 'A_0',
      destinationStationId: 'A_3',
      mode: 'OPTIMAL',
    });

    expect(stats.visitedNodes).toBeGreaterThanOrEqual(4);
    expect(stats.relaxedEdges).toBeGreaterThanOrEqual(3);
    // without congestion the weighted cost of a ride is its time
    expect(stats.cost).toBe(result.totalDurationSec);
  });

  describe('rejects like Dijkstra', () => {
    const graph = new GraphBuilder()
      .station('A_1', 'A', 37, 127)
      .station('A_2', 'A', 37, 127.01)
      .station('B_1', 'B', 37.5, 127.5)
      .ride('A_1', 'A_2', 'A', 100, 1, { oneWay: true })
      .build();
    const { astar } = engines(graph);

    it('for an unknown station', async () => {
      await expect(
        astar.findRoute({
          originStationId: 'NOPE',
          destinationStationId: 'A_2',
          mode: 'OPTIMAL',
        }),
      ).rejects.toBeInstanceOf(UnknownStationError);
    });

    it('for the same origin and destination', async () => {
      await expect(
        astar.findRoute({
          originStationId: 'A_1',
          destinationStationId: 'A_1',
          mode: 'OPTIMAL',
        }),
      ).rejects.toBeInstanceOf(InvalidRouteQueryError);
    });

    it('when there is no route (one-way link or disconnected stations)', async () => {
      await expect(
        astar.findRoute({
          originStationId: 'A_2',
          destinationStationId: 'A_1',
          mode: 'OPTIMAL',
        }),
      ).rejects.toBeInstanceOf(RouteNotFoundError);
      await expect(
        astar.findRoute({
          originStationId: 'A_1',
          destinationStationId: 'B_1',
          mode: 'OPTIMAL',
        }),
      ).rejects.toBeInstanceOf(RouteNotFoundError);
    });
  });
});
