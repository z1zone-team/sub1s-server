import { FareRule } from '../../domain/subway/fare/fare-calculator';
import {
  InvalidRouteQueryError,
  RouteNotFoundError,
  UnknownStationError,
} from '../../domain/subway/models/route';
import {
  GraphData,
  RouteEdgeRecord,
  StationRecord,
  SubwayGraph,
  TransferEdgeRecord,
} from '../../domain/subway/models/subway-graph';
import {
  ICongestionProvider,
  NoCongestionProvider,
} from '../../domain/subway/ports/ICongestionProvider';
import { DijkstraRouteEngine } from './dijkstra-route.engine';

const FARE_RULE: FareRule = {
  effectiveFrom: '2026-01-01',
  baseFare: 1550,
  baseDistanceKm: 10,
  tiers: [
    { fromKm: 10, toKm: 50, stepKm: 5, stepFare: 100 },
    { fromKm: 50, stepKm: 8, stepFare: 100 },
  ],
  lineSurcharges: [{ type: 'flat', lineId: 'X', fare: 500 }],
};

// small fixture builder: every ride link is added in both directions unless oneWay is set
class GraphBuilder {
  private readonly stations: StationRecord[] = [];
  private readonly edges: RouteEdgeRecord[] = [];
  private readonly transfers: TransferEdgeRecord[] = [];

  station(id: string, lineId: string): this {
    this.stations.push({
      id,
      lineId,
      stationName: id,
      lat: 37,
      lng: 127,
      lineSeq: this.stations.length + 1,
    });
    return this;
  }

  ride(
    from: string,
    to: string,
    lineId: string,
    durationSec: number,
    distanceKm = 1,
    options: { oneWay?: boolean; forward?: string; backward?: string } = {},
  ): this {
    const forward = options.forward ?? 'DOWN';
    const backward = options.backward ?? 'UP';
    this.edges.push(
      this.edge(from, to, lineId, durationSec, distanceKm, forward),
    );
    if (!options.oneWay) {
      this.edges.push(
        this.edge(to, from, lineId, durationSec, distanceKm, backward),
      );
    }
    return this;
  }

  transfer(a: string, b: string, walkingDurationSec: number): this {
    this.transfers.push({
      fromStationId: a,
      toStationId: b,
      walkingDurationSec,
    });
    this.transfers.push({
      fromStationId: b,
      toStationId: a,
      walkingDurationSec,
    });
    return this;
  }

  build(): SubwayGraph {
    const data: GraphData = {
      stations: this.stations,
      edges: this.edges,
      transfers: this.transfers,
    };
    return new SubwayGraph(data);
  }

  private edge(
    from: string,
    to: string,
    lineId: string,
    durationSec: number,
    distanceKm: number,
    direction: string,
  ): RouteEdgeRecord {
    return {
      fromStationId: from,
      toStationId: to,
      lineId,
      direction,
      isExpress: false,
      distanceKm,
      durationSec,
      isEstimated: false,
    };
  }
}

function engineFor(
  graph: SubwayGraph,
  congestion: ICongestionProvider = new NoCongestionProvider(),
): DijkstraRouteEngine {
  return new DijkstraRouteEngine(
    { getGraph: () => graph },
    congestion,
    FARE_RULE,
  );
}

describe('DijkstraRouteEngine', () => {
  describe('direct trip on one line', () => {
    const graph = new GraphBuilder()
      .station('A_1', 'A')
      .station('A_2', 'A')
      .station('A_3', 'A')
      .station('A_4', 'A')
      .ride('A_1', 'A_2', 'A', 100, 1.5)
      .ride('A_2', 'A_3', 'A', 120, 2)
      .ride('A_3', 'A_4', 'A', 80, 1)
      .build();

    it('returns the stations, one segment and the summed time and distance', async () => {
      const result = await engineFor(graph).findRoute({
        originStationId: 'A_1',
        destinationStationId: 'A_4',
        mode: 'OPTIMAL',
      });

      expect(result.stationIds).toEqual(['A_1', 'A_2', 'A_3', 'A_4']);
      expect(result.transferCount).toBe(0);
      expect(result.totalDurationSec).toBe(300);
      expect(result.totalDistanceKm).toBeCloseTo(4.5);
      expect(result.totalFare).toBe(1550);
      expect(result.segments).toEqual([
        {
          lineId: 'A',
          direction: 'DOWN',
          isExpress: false,
          fromStationId: 'A_1',
          toStationId: 'A_4',
          stationCount: 3,
          durationSec: 300,
          distanceKm: 4.5,
        },
      ]);
    });

    it('reports the reverse direction as UP', async () => {
      const result = await engineFor(graph).findRoute({
        originStationId: 'A_3',
        destinationStationId: 'A_1',
        mode: 'OPTIMAL',
      });

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].direction).toBe('UP');
      expect(result.totalDurationSec).toBe(220);
    });
  });

  describe('trip with one transfer', () => {
    const graph = new GraphBuilder()
      .station('A_1', 'A')
      .station('A_2', 'A')
      .station('A_3', 'A')
      .station('B_3', 'B')
      .station('B_4', 'B')
      .ride('A_1', 'A_2', 'A', 100)
      .ride('A_2', 'A_3', 'A', 100)
      .ride('B_3', 'B_4', 'B', 150)
      .transfer('A_3', 'B_3', 120)
      .build();

    it('splits segments at the transfer and adds the walking time', async () => {
      const result = await engineFor(graph).findRoute({
        originStationId: 'A_1',
        destinationStationId: 'B_4',
        mode: 'OPTIMAL',
      });

      expect(result.stationIds).toEqual(['A_1', 'A_2', 'A_3', 'B_3', 'B_4']);
      expect(result.transferCount).toBe(1);
      expect(result.segments.map((s) => s.lineId)).toEqual(['A', 'B']);
      expect(result.transfers).toEqual([
        { fromStationId: 'A_3', toStationId: 'B_3', walkingDurationSec: 120 },
      ]);
    });

    it('does not add the transfer penalty to the reported duration', async () => {
      const result = await engineFor(graph).findRoute({
        originStationId: 'A_1',
        destinationStationId: 'B_4',
        mode: 'COMFORTABLE',
      });

      // 100 + 100 + 120 walk + 150, without the 300s penalty used while searching
      expect(result.totalDurationSec).toBe(470);
    });
  });

  describe('loop line', () => {
    const builder = new GraphBuilder();
    const ids = ['L_1', 'L_2', 'L_3', 'L_4', 'L_5', 'L_6'];
    ids.forEach((id) => builder.station(id, 'L'));
    ids.forEach((id, i) => {
      builder.ride(id, ids[(i + 1) % ids.length], 'L', 100, 1, {
        forward: 'OUTER',
        backward: 'INNER',
      });
    });
    const graph = builder.build();

    it('takes the shorter way around and reports the loop direction', async () => {
      const result = await engineFor(graph).findRoute({
        originStationId: 'L_1',
        destinationStationId: 'L_5',
        mode: 'OPTIMAL',
      });

      expect(result.stationIds).toEqual(['L_1', 'L_6', 'L_5']);
      expect(result.segments[0].direction).toBe('INNER');
      expect(result.totalDurationSec).toBe(200);
    });

    it('terminates and finds the long way when the short way is blocked', async () => {
      const result = await engineFor(graph).findRoute({
        originStationId: 'L_1',
        destinationStationId: 'L_5',
        mode: 'OPTIMAL',
        blockedSegments: [{ fromStationId: 'L_1', toStationId: 'L_6' }],
      });

      expect(result.stationIds).toEqual(['L_1', 'L_2', 'L_3', 'L_4', 'L_5']);
      expect(result.segments[0].direction).toBe('OUTER');
    });
  });

  describe('one-way links', () => {
    const graph = new GraphBuilder()
      .station('O_1', 'O')
      .station('O_2', 'O')
      .station('O_3', 'O')
      .ride('O_1', 'O_2', 'O', 100, 1, { oneWay: true })
      .ride('O_2', 'O_3', 'O', 100, 1, { oneWay: true })
      .ride('O_3', 'O_1', 'O', 100, 1, { oneWay: true })
      .build();

    it('goes around the loop instead of using a missing reverse link', async () => {
      const result = await engineFor(graph).findRoute({
        originStationId: 'O_2',
        destinationStationId: 'O_1',
        mode: 'OPTIMAL',
      });

      expect(result.stationIds).toEqual(['O_2', 'O_3', 'O_1']);
      expect(result.totalDurationSec).toBe(200);
    });
  });

  describe('four modes on the same pair of stations', () => {
    // route 1: direct on the congested surcharge line X (600s)
    // route 2: transfer to line Y and back (60 + 640 + 60 walking), no surcharge
    const graph = new GraphBuilder()
      .station('X_O', 'X')
      .station('X_D', 'X')
      .station('Y_O', 'Y')
      .station('Y_D', 'Y')
      .ride('X_O', 'X_D', 'X', 600, 5)
      .ride('Y_O', 'Y_D', 'Y', 640, 6)
      .transfer('X_O', 'Y_O', 60)
      .transfer('X_D', 'Y_D', 60)
      .build();
    const congestion: ICongestionProvider = {
      getCongestion: (lineId) => (lineId === 'X' ? 0.9 : 0),
    };
    const query = { originStationId: 'X_O', destinationStationId: 'X_D' };

    it('OPTIMAL ignores congestion and picks the fastest route', async () => {
      const result = await engineFor(graph, congestion).findRoute({
        ...query,
        mode: 'OPTIMAL',
      });

      expect(result.stationIds).toEqual(['X_O', 'X_D']);
      expect(result.totalDurationSec).toBe(600);
    });

    it('COMFORTABLE detours around the congested line', async () => {
      const result = await engineFor(graph, congestion).findRoute({
        ...query,
        mode: 'COMFORTABLE',
      });

      expect(result.stationIds).toEqual(['X_O', 'Y_O', 'Y_D', 'X_D']);
      expect(result.transferCount).toBe(2);
      expect(result.totalDurationSec).toBe(760);
    });

    it('PERSONAL uses the weights it is given', async () => {
      const avoidsCrowds = await engineFor(graph, congestion).findRoute({
        ...query,
        mode: 'PERSONAL',
        weights: { congestion: 5, transferSec: 0 },
      });
      const hatesTransfers = await engineFor(graph, congestion).findRoute({
        ...query,
        mode: 'PERSONAL',
        weights: { congestion: 0, transferSec: 900 },
      });

      expect(avoidsCrowds.stationIds).toEqual(['X_O', 'Y_O', 'Y_D', 'X_D']);
      expect(hatesTransfers.stationIds).toEqual(['X_O', 'X_D']);
    });

    it('PERSONAL without weights is an invalid query', async () => {
      await expect(
        engineFor(graph, congestion).findRoute({ ...query, mode: 'PERSONAL' }),
      ).rejects.toBeInstanceOf(InvalidRouteQueryError);
    });

    it('CHEAPEST avoids the surcharge line even though it is slower', async () => {
      const cheapest = await engineFor(graph, congestion).findRoute({
        ...query,
        mode: 'CHEAPEST',
      });
      const optimal = await engineFor(graph, congestion).findRoute({
        ...query,
        mode: 'OPTIMAL',
      });

      expect(optimal.totalFare).toBe(2050);
      expect(cheapest.totalFare).toBe(1550);
      expect(cheapest.stationIds).toEqual(['X_O', 'Y_O', 'Y_D', 'X_D']);
    });

    it('CHEAPEST still returns a route when it cannot avoid the surcharge line', async () => {
      const onlyX = new GraphBuilder()
        .station('X_1', 'X')
        .station('X_2', 'X')
        .ride('X_1', 'X_2', 'X', 100, 2)
        .build();

      const result = await engineFor(onlyX).findRoute({
        originStationId: 'X_1',
        destinationStationId: 'X_2',
        mode: 'CHEAPEST',
      });

      expect(result.stationIds).toEqual(['X_1', 'X_2']);
      expect(result.totalFare).toBe(2050);
    });
  });

  describe('disruptions', () => {
    const graph = new GraphBuilder()
      .station('X_O', 'X')
      .station('X_D', 'X')
      .station('Y_O', 'Y')
      .station('Y_D', 'Y')
      .ride('X_O', 'X_D', 'X', 600, 5)
      .ride('Y_O', 'Y_D', 'Y', 640, 6)
      .transfer('X_O', 'Y_O', 60)
      .transfer('X_D', 'Y_D', 60)
      .build();

    it('re-routes around a blocked segment in either direction', async () => {
      const forward = await engineFor(graph).findRoute({
        originStationId: 'X_O',
        destinationStationId: 'X_D',
        mode: 'OPTIMAL',
        blockedSegments: [{ fromStationId: 'X_O', toStationId: 'X_D' }],
      });
      const reversed = await engineFor(graph).findRoute({
        originStationId: 'X_O',
        destinationStationId: 'X_D',
        mode: 'OPTIMAL',
        blockedSegments: [{ fromStationId: 'X_D', toStationId: 'X_O' }],
      });

      expect(forward.stationIds).toEqual(['X_O', 'Y_O', 'Y_D', 'X_D']);
      expect(reversed.stationIds).toEqual(forward.stationIds);
    });

    it('rejects with RouteNotFoundError when every way is blocked', async () => {
      await expect(
        engineFor(graph).findRoute({
          originStationId: 'X_O',
          destinationStationId: 'X_D',
          mode: 'OPTIMAL',
          blockedSegments: [
            { fromStationId: 'X_O', toStationId: 'X_D' },
            { fromStationId: 'Y_O', toStationId: 'Y_D' },
          ],
        }),
      ).rejects.toBeInstanceOf(RouteNotFoundError);
    });

    it('does not change the graph between queries', async () => {
      const engine = engineFor(graph);
      const base = { originStationId: 'X_O', destinationStationId: 'X_D' };
      const before = await engine.findRoute({ ...base, mode: 'OPTIMAL' });
      await engine.findRoute({
        ...base,
        mode: 'OPTIMAL',
        blockedSegments: [{ fromStationId: 'X_O', toStationId: 'X_D' }],
      });
      const after = await engine.findRoute({ ...base, mode: 'OPTIMAL' });

      expect(after).toEqual(before);
    });
  });

  describe('congestion at the time of riding', () => {
    const chain = new GraphBuilder()
      .station('O_1', 'O')
      .station('O_2', 'O')
      .station('O_3', 'O')
      .ride('O_1', 'O_2', 'O', 100)
      .ride('O_2', 'O_3', 'O', 200)
      .build();

    it('asks for the congestion at the departure time plus the time already spent', async () => {
      const calls: { from: string; direction: string; at: number }[] = [];
      const provider: ICongestionProvider = {
        getCongestion: (_line, from, _to, direction, at) => {
          calls.push({ from, direction, at });
          return 0;
        },
      };
      const departureAt = new Date('2026-10-05T08:00:00+09:00');

      await engineFor(chain, provider).findRoute({
        originStationId: 'O_1',
        destinationStationId: 'O_3',
        mode: 'COMFORTABLE',
        departureAt,
      });

      const down = calls.filter((c) => c.direction === 'DOWN');
      expect(down.find((c) => c.from === 'O_1')?.at).toBe(
        departureAt.getTime(),
      );
      expect(down.find((c) => c.from === 'O_2')?.at).toBe(
        departureAt.getTime() + 100_000,
      );
    });

    it('uses the current time when no departure time is given', async () => {
      const seen: number[] = [];
      const provider: ICongestionProvider = {
        getCongestion: (_l, _f, _t, _d, at) => {
          seen.push(at);
          return 0;
        },
      };
      const before = Date.now();

      await engineFor(chain, provider).findRoute({
        originStationId: 'O_1',
        destinationStationId: 'O_3',
        mode: 'COMFORTABLE',
      });

      expect(seen.length).toBeGreaterThan(0);
      expect(Math.min(...seen)).toBeGreaterThanOrEqual(before);
      expect(Math.min(...seen)).toBeLessThanOrEqual(Date.now());
    });

    it('chooses a different route depending on the departure time', async () => {
      const graph = new GraphBuilder()
        .station('X_O', 'X')
        .station('X_D', 'X')
        .station('Y_O', 'Y')
        .station('Y_D', 'Y')
        .ride('X_O', 'X_D', 'X', 600, 5)
        .ride('Y_O', 'Y_D', 'Y', 640, 6)
        .transfer('X_O', 'Y_O', 60)
        .transfer('X_D', 'Y_D', 60)
        .build();
      const noon = new Date('2026-10-05T12:00:00+09:00').getTime();
      const crowdedInTheMorning: ICongestionProvider = {
        getCongestion: (lineId, _f, _t, _d, at) =>
          lineId === 'X' && at < noon ? 0.9 : 0,
      };
      const query = {
        originStationId: 'X_O',
        destinationStationId: 'X_D',
        mode: 'COMFORTABLE' as const,
      };

      const morning = await engineFor(graph, crowdedInTheMorning).findRoute({
        ...query,
        departureAt: new Date('2026-10-05T08:00:00+09:00'),
      });
      const afternoon = await engineFor(graph, crowdedInTheMorning).findRoute({
        ...query,
        departureAt: new Date('2026-10-05T14:00:00+09:00'),
      });

      expect(morning.stationIds).toEqual(['X_O', 'Y_O', 'Y_D', 'X_D']);
      expect(afternoon.stationIds).toEqual(['X_O', 'X_D']);
    });
  });

  describe('invalid queries', () => {
    const graph = new GraphBuilder()
      .station('A_1', 'A')
      .station('A_2', 'A')
      .station('B_1', 'B')
      .ride('A_1', 'A_2', 'A', 100, 1, { oneWay: true })
      .build();

    it('rejects an unknown station', async () => {
      await expect(
        engineFor(graph).findRoute({
          originStationId: 'NOPE',
          destinationStationId: 'A_2',
          mode: 'OPTIMAL',
        }),
      ).rejects.toBeInstanceOf(UnknownStationError);
    });

    it('rejects an identical origin and destination', async () => {
      await expect(
        engineFor(graph).findRoute({
          originStationId: 'A_1',
          destinationStationId: 'A_1',
          mode: 'OPTIMAL',
        }),
      ).rejects.toBeInstanceOf(InvalidRouteQueryError);
    });

    it('rejects with RouteNotFoundError against a one-way link', async () => {
      await expect(
        engineFor(graph).findRoute({
          originStationId: 'A_2',
          destinationStationId: 'A_1',
          mode: 'OPTIMAL',
        }),
      ).rejects.toBeInstanceOf(RouteNotFoundError);
    });

    it('rejects with RouteNotFoundError between disconnected stations', async () => {
      await expect(
        engineFor(graph).findRoute({
          originStationId: 'A_1',
          destinationStationId: 'B_1',
          mode: 'OPTIMAL',
        }),
      ).rejects.toBeInstanceOf(RouteNotFoundError);
    });
  });
});
