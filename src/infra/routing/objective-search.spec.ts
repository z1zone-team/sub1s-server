import { DijkstraRouteEngine } from './dijkstra-route.engine';
import { AStarRouteEngine } from './astar-route.engine';
import { NoCongestionProvider } from '../../domain/subway/ports/ICongestionProvider';
import { GraphBuilder, FARE_RULE } from './test-support/graph-builder';
import { RouteMode } from '../../domain/subway/models/route';

const run = (
  graph: ReturnType<GraphBuilder['build']>,
  mode: RouteMode,
  astar = false,
) =>
  new (astar ? AStarRouteEngine : DijkstraRouteEngine)(
    { getGraph: () => graph },
    new NoCongestionProvider(),
    FARE_RULE,
  ).findRoute({ originStationId: 'S', destinationStationId: 'T', mode });

describe('strict route objectives', () => {
  it('fewest transfers stays primary even when a transfer saves more than ten hours', async () => {
    const graph = new GraphBuilder()
      .station('S', 'A')
      .station('A', 'A')
      .station('B', 'B')
      .station('T', 'A')
      .ride('S', 'T', 'A', 40000)
      .ride('S', 'A', 'A', 10)
      .transfer('A', 'B', 10)
      .ride('B', 'T', 'B', 10)
      .build();
    expect((await run(graph, 'FEWEST_TRANSFERS')).transferCount).toBe(0);
    expect((await run(graph, 'FASTEST')).totalDurationSec).toBe(30);
  });
  it('minimizes walking rather than rail mileage and uses physical time on equal walks', async () => {
    const graph = new GraphBuilder()
      .station('S', 'A')
      .station('A', 'A')
      .station('B', 'B')
      .station('C', 'A')
      .station('D', 'B')
      .station('T', 'B')
      .ride('S', 'A', 'A', 100, 50)
      .transfer('A', 'B', 10)
      .ride('B', 'T', 'B', 100, 50)
      .ride('S', 'C', 'A', 1, 1)
      .transfer('C', 'D', 20)
      .ride('D', 'T', 'B', 1, 1)
      .build();
    expect((await run(graph, 'LEAST_WALK')).stationIds).toContain('A');
    expect((await run(graph, 'FASTEST')).stationIds).toContain('C');
    expect(await run(graph, 'LEAST_WALK', true)).toEqual(
      await run(graph, 'LEAST_WALK'),
    );
  });
  it('keeps tied prefixes at a merge until path-dependent fare is evaluated', async () => {
    const graph = new GraphBuilder()
      .station('S', 'A')
      .station('A', 'X')
      .station('B', 'A')
      .station('C', 'A')
      .station('T', 'A')
      .ride('S', 'A', 'X', 5)
      .ride('A', 'C', 'X', 5)
      .ride('S', 'B', 'A', 5)
      .ride('B', 'C', 'A', 5)
      .ride('C', 'T', 'A', 10)
      .build();
    for (const mode of ['LEAST_WALK', 'FEWEST_TRANSFERS'] as const) {
      const chosen = await run(graph, mode);
      expect(chosen.stationIds).toEqual(['S', 'B', 'C', 'T']);
      expect(chosen.totalFare).toBe(1550);
    }
  });
  it('counts consecutive transfer corridors as one train change', async () => {
    const graph = new GraphBuilder()
      .station('S', 'A')
      .station('A', 'A')
      .station('B', 'B')
      .station('C', 'C')
      .station('T', 'C')
      .ride('S', 'A', 'A', 10)
      .transfer('A', 'B', 10)
      .transfer('B', 'C', 10)
      .ride('C', 'T', 'C', 10)
      .ride('S', 'T', 'A', 100)
      .build();
    expect((await run(graph, 'FASTEST')).transferCount).toBe(1);
    expect((await run(graph, 'FEWEST_TRANSFERS')).transferCount).toBe(0);
  });
  it('honors blocked segments for new objectives', async () => {
    const graph = new GraphBuilder()
      .station('S', 'A')
      .station('A', 'A')
      .station('T', 'A')
      .ride('S', 'T', 'A', 10)
      .ride('S', 'A', 'A', 20)
      .ride('A', 'T', 'A', 20)
      .build();
    const engine = new DijkstraRouteEngine(
      { getGraph: () => graph },
      new NoCongestionProvider(),
      FARE_RULE,
    );
    const route = await engine.findRoute({
      originStationId: 'S',
      destinationStationId: 'T',
      mode: 'FASTEST',
      blockedSegments: [{ fromStationId: 'S', toStationId: 'T' }],
    });
    expect(route.stationIds).toEqual(['S', 'A', 'T']);
  });
});
