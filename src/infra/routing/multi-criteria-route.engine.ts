import { Inject } from '@nestjs/common';
import {
  FareRule,
  RiddenEdge,
  calculateFare,
} from '../../domain/subway/fare/fare-calculator';
import {
  InvalidRouteQueryError,
  ROUTE_MODE_WEIGHTS,
  RouteMode,
  RouteNotFoundError,
  RouteQuery,
  RouteResult,
  RouteSegment,
  RouteTransfer,
  UnknownStationError,
} from '../../domain/subway/models/route';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import {
  CONGESTION_PROVIDER,
  ICongestionProvider,
} from '../../domain/subway/ports/ICongestionProvider';
import { ISubwayRouteEngine } from '../../domain/subway/ports/ISubwayRouteEngine';
import { MinPriorityQueue } from './min-priority-queue';

export interface SubwayGraphSource {
  getGraph(): SubwayGraph;
}

export const SUBWAY_GRAPH_SOURCE = Symbol('SUBWAY_GRAPH_SOURCE');
export const FARE_RULE = Symbol('FARE_RULE');

// how the search prices a ride edge and a transfer. 'time' is the multi-criteria cost of ADR-001,
// 'distance' ranks routes by kilometers (the integrated fare grows with distance).
export interface SearchParams {
  metric: 'time' | 'distance';
  congestion: number;
  transferSec: number;
  blockedPairs?: Set<number>;
  blockedLines?: Set<string>;
  departureMs: number;
}

export interface SearchStats {
  // stations taken off the queue and expanded
  visitedNodes: number;
  // edges and transfers that improved a station's cost
  relaxedEdges: number;
  // weighted cost of the returned route (the search cost, not the real travel time)
  cost: number;
}

export interface RouteWithStats {
  result: RouteResult;
  stats: SearchStats;
}

interface Step {
  from: number;
  // index into edgesFrom(from) for a ride, or into transfersFrom(from) for a transfer
  link: number;
  isTransfer: boolean;
}

// a transfer costs slightly more than nothing so that equal-distance routes prefer fewer transfers
const DISTANCE_METRIC_TRANSFER_COST = 0.01;
// large enough that any detour is cheaper than one more transfer
const MIN_TRANSFER_PENALTY_SEC = 36000;

// Multi-criteria shortest path search (ADR-001). The search is Dijkstra's algorithm with an optional
// heuristic: without one it is Dijkstra, with an admissible and consistent one it is A* and finds the
// same cheapest cost while expanding fewer stations.
export abstract class MultiCriteriaRouteEngine implements ISubwayRouteEngine {
  constructor(
    @Inject(SUBWAY_GRAPH_SOURCE) protected readonly source: SubwayGraphSource,
    @Inject(CONGESTION_PROVIDER)
    protected readonly congestion: ICongestionProvider,
    @Inject(FARE_RULE) protected readonly fareRule: FareRule,
  ) {}

  findRoute(query: RouteQuery): Promise<RouteResult> {
    return this.findRouteWithStats(query).then((outcome) => outcome.result);
  }

  findRouteWithStats(query: RouteQuery): Promise<RouteWithStats> {
    try {
      return Promise.resolve(this.findRouteWithStatsSync(query));
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  // The same search without a Promise, so a benchmark measures the search and nothing else.
  findRouteWithStatsSync(query: RouteQuery): RouteWithStats {
    return this.search(query);
  }

  // A lower bound of the remaining cost from a station to the destination, or undefined for none.
  // It must never exceed the real remaining cost and must satisfy h(u) <= cost(u, v) + h(v).
  protected abstract heuristic(
    graph: SubwayGraph,
    destination: number,
    params: SearchParams,
  ): ((station: number) => number) | undefined;

  private search(query: RouteQuery): RouteWithStats {
    const graph = this.source.getGraph();
    if (query.originStationId === query.destinationStationId) {
      throw new InvalidRouteQueryError(
        'origin and destination must be different stations',
      );
    }
    const origin = graph.indexOf(query.originStationId);
    if (origin === undefined)
      throw new UnknownStationError(query.originStationId);
    const destination = graph.indexOf(query.destinationStationId);
    if (destination === undefined)
      throw new UnknownStationError(query.destinationStationId);

    const blockedPairs = this.blockedPairs(graph, query);
    const departureMs = query.departureAt?.getTime() ?? Date.now();
    const totals = { visitedNodes: 0, relaxedEdges: 0 };

    if (query.mode === 'CHEAPEST') {
      const best = this.findCheapest(
        graph,
        origin,
        destination,
        query,
        blockedPairs,
        departureMs,
        totals,
      );
      return { result: best.result, stats: { ...totals, cost: best.cost } };
    }

    const weights = this.weightsFor(query);
    const found = this.searchPath(
      graph,
      origin,
      destination,
      {
        metric: 'time',
        congestion: weights.congestion,
        transferSec: weights.transferSec,
        blockedPairs,
        departureMs,
      },
      totals,
    );
    if (!found) throw new RouteNotFoundError();
    return {
      result: this.toResult(graph, found.steps, query.mode, query.weekend),
      stats: { ...totals, cost: found.cost },
    };
  }

  private weightsFor(query: RouteQuery): {
    congestion: number;
    transferSec: number;
  } {
    if (query.mode === 'PERSONAL') {
      const weights = query.weights;
      if (!weights) {
        throw new InvalidRouteQueryError('PERSONAL mode requires weights');
      }
      if (weights.congestion < 0 || weights.transferSec < 0) {
        throw new InvalidRouteQueryError('weights must not be negative');
      }
      return weights;
    }
    if (query.mode === 'CHEAPEST' || query.mode === 'ONLY_WALK') {
      return ROUTE_MODE_WEIGHTS.OPTIMAL;
    }
    return ROUTE_MODE_WEIGHTS[query.mode];
  }

  // The fare is not a sum of edge costs, so the cheapest route is chosen among candidate routes
  // (fastest, shortest, fewest transfers, and without separately priced lines) by their real fare.
  private findCheapest(
    graph: SubwayGraph,
    origin: number,
    destination: number,
    query: RouteQuery,
    blockedPairs: Set<number> | undefined,
    departureMs: number,
    totals: { visitedNodes: number; relaxedEdges: number },
  ): { result: RouteResult; cost: number } {
    const fastest = ROUTE_MODE_WEIGHTS.OPTIMAL;
    const candidates: SearchParams[] = [
      {
        metric: 'time',
        congestion: fastest.congestion,
        transferSec: fastest.transferSec,
        blockedPairs,
        departureMs,
      },
      {
        metric: 'distance',
        congestion: 0,
        transferSec: 0,
        blockedPairs,
        departureMs,
      },
      {
        metric: 'time',
        congestion: 0,
        transferSec: MIN_TRANSFER_PENALTY_SEC,
        blockedPairs,
        departureMs,
      },
      {
        metric: 'time',
        congestion: fastest.congestion,
        transferSec: fastest.transferSec,
        blockedPairs,
        departureMs,
        blockedLines: this.separatelyPricedLines(),
      },
    ];

    const seen = new Set<string>();
    let best: { result: RouteResult; cost: number } | undefined;
    let fareError: Error | undefined;
    for (const params of candidates) {
      const found = this.searchPath(graph, origin, destination, params, totals);
      if (!found) continue;
      const signature = found.steps
        .map((s) => `${s.from}:${s.isTransfer ? 't' : 'r'}${s.link}`)
        .join(',');
      if (seen.has(signature)) continue;
      seen.add(signature);

      let result: RouteResult;
      try {
        result = this.toResult(graph, found.steps, 'CHEAPEST', query.weekend);
      } catch (error) {
        fareError = error as Error;
        continue;
      }
      if (!best || isCheaper(result, best.result)) {
        best = { result, cost: found.cost };
      }
    }
    if (best) return best;
    if (fareError) throw fareError;
    throw new RouteNotFoundError();
  }

  private separatelyPricedLines(): Set<string> {
    const lines = new Set<string>();
    for (const s of this.fareRule.lineSurcharges ?? []) lines.add(s.lineId);
    for (const p of this.fareRule.pairFares ?? []) lines.add(p.lineId);
    for (const z of this.fareRule.independentZones ?? []) lines.add(z.lineId);
    return lines;
  }

  private blockedPairs(
    graph: SubwayGraph,
    query: RouteQuery,
  ): Set<number> | undefined {
    if (!query.blockedSegments?.length) return undefined;
    const pairs = new Set<number>();
    for (const segment of query.blockedSegments) {
      const a = graph.indexOf(segment.fromStationId);
      const b = graph.indexOf(segment.toStationId);
      if (a === undefined) throw new UnknownStationError(segment.fromStationId);
      if (b === undefined) throw new UnknownStationError(segment.toStationId);
      pairs.add(a * graph.stationCount + b);
      pairs.add(b * graph.stationCount + a);
    }
    return pairs;
  }

  // Dijkstra / A* over per-line station nodes. Every relaxation needs a strictly smaller cost,
  // so loops (line 2) and repeated visits cannot enqueue forever.
  private searchPath(
    graph: SubwayGraph,
    origin: number,
    destination: number,
    params: SearchParams,
    totals: { visitedNodes: number; relaxedEdges: number },
  ): { steps: Step[]; cost: number } | undefined {
    const count = graph.stationCount;
    const dist = new Float64Array(count).fill(Infinity);
    const prevNode = new Int32Array(count).fill(-1);
    const prevLink = new Int32Array(count).fill(-1);
    const prevIsTransfer = new Uint8Array(count);
    // physical seconds spent when reaching each station by its cheapest path, used to look up the
    // congestion at the time of riding
    const elapsedSec = new Float64Array(count);
    const queue = new MinPriorityQueue(256);
    const remaining = this.heuristic(graph, destination, params);

    dist[origin] = 0;
    queue.push(origin, remaining ? remaining(origin) : 0);

    while (queue.size > 0) {
      const current = queue.pop();
      const priority = queue.lastPriority;
      const currentCost = dist[current];
      // a queue entry is stale when the station has been reached more cheaply since it was pushed
      if (priority > currentCost + (remaining ? remaining(current) : 0)) {
        continue;
      }
      totals.visitedNodes += 1;
      if (current === destination) break;

      const edges = graph.edgesFrom(current);
      for (let i = 0; i < edges.length; i += 1) {
        const edge = edges[i];
        if (params.blockedPairs?.has(current * count + edge.toIndex)) continue;
        if (params.blockedLines?.has(edge.lineId)) continue;

        let cost: number;
        if (params.metric === 'distance') {
          cost = edge.distanceKm;
        } else if (params.congestion === 0) {
          cost = edge.durationSec;
        } else {
          const level = this.congestion.getCongestion(
            edge.lineId,
            graph.station(current).id,
            graph.station(edge.toIndex).id,
            edge.direction,
            params.departureMs + elapsedSec[current] * 1000,
          );
          cost = edge.durationSec * (1 + params.congestion * level);
        }
        const next = currentCost + cost;
        if (next >= dist[edge.toIndex]) continue;
        dist[edge.toIndex] = next;
        prevNode[edge.toIndex] = current;
        prevLink[edge.toIndex] = i;
        prevIsTransfer[edge.toIndex] = 0;
        elapsedSec[edge.toIndex] = elapsedSec[current] + edge.durationSec;
        totals.relaxedEdges += 1;
        queue.push(
          edge.toIndex,
          next + (remaining ? remaining(edge.toIndex) : 0),
        );
      }

      const transfers = graph.transfersFrom(current);
      for (let i = 0; i < transfers.length; i += 1) {
        const transfer = transfers[i];
        const cost =
          params.metric === 'distance'
            ? DISTANCE_METRIC_TRANSFER_COST
            : transfer.walkingDurationSec + params.transferSec;
        const next = currentCost + cost;
        if (next >= dist[transfer.toIndex]) continue;
        dist[transfer.toIndex] = next;
        prevNode[transfer.toIndex] = current;
        prevLink[transfer.toIndex] = i;
        prevIsTransfer[transfer.toIndex] = 1;
        elapsedSec[transfer.toIndex] =
          elapsedSec[current] + transfer.walkingDurationSec;
        totals.relaxedEdges += 1;
        queue.push(
          transfer.toIndex,
          next + (remaining ? remaining(transfer.toIndex) : 0),
        );
      }
    }

    if (dist[destination] === Infinity) return undefined;

    const steps: Step[] = [];
    for (let node = destination; node !== origin; node = prevNode[node]) {
      steps.push({
        from: prevNode[node],
        link: prevLink[node],
        isTransfer: prevIsTransfer[node] === 1,
      });
    }
    return { steps: steps.reverse(), cost: dist[destination] };
  }

  private toResult(
    graph: SubwayGraph,
    steps: Step[],
    mode: RouteMode,
    weekend?: boolean,
  ): RouteResult {
    const stationIds: string[] = [graph.station(steps[0].from).id];
    const segments: RouteSegment[] = [];
    const transfers: RouteTransfer[] = [];
    const ridden: RiddenEdge[] = [];
    let totalDurationSec = 0;
    let totalDistanceKm = 0;
    let open: RouteSegment | undefined;

    for (const step of steps) {
      const fromId = graph.station(step.from).id;
      if (step.isTransfer) {
        const transfer = graph.transfersFrom(step.from)[step.link];
        const toId = graph.station(transfer.toIndex).id;
        const transferEntry: RouteTransfer = {
          fromStationId: fromId,
          toStationId: toId,
          walkingDurationSec: transfer.walkingDurationSec,
        };
        if (transfer.isEstimated) {
          transferEntry.isEstimated = true;
        }
        transfers.push(transferEntry);
        totalDurationSec += transfer.walkingDurationSec;
        stationIds.push(toId);
        open = undefined;
        continue;
      }

      const edge = graph.edgesFrom(step.from)[step.link];
      const toId = graph.station(edge.toIndex).id;
      totalDurationSec += edge.durationSec;
      totalDistanceKm += edge.distanceKm;
      stationIds.push(toId);
      ridden.push({
        lineId: edge.lineId,
        fromStationId: fromId,
        toStationId: toId,
        distanceKm: edge.distanceKm,
      });

      if (open && open.lineId === edge.lineId) {
        open.toStationId = toId;
        open.stationCount += 1;
        open.durationSec += edge.durationSec;
        open.distanceKm = round(open.distanceKm + edge.distanceKm);
        if (edge.isEstimated) open.isEstimated = true;
      } else {
        open = {
          lineId: edge.lineId,
          direction: edge.direction,
          isExpress: edge.isExpress,
          fromStationId: fromId,
          toStationId: toId,
          stationCount: 1,
          durationSec: edge.durationSec,
          distanceKm: edge.distanceKm,
        };
        if (edge.isEstimated) open.isEstimated = true;
        segments.push(open);
      }
    }

    totalDistanceKm = round(totalDistanceKm);
    return {
      mode,
      stationIds,
      segments,
      transfers,
      totalDurationSec,
      totalDistanceKm,
      transferCount: transfers.length,
      totalFare: calculateFare(totalDistanceKm, this.fareRule, ridden, {
        weekend,
      }),
    };
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isCheaper(candidate: RouteResult, best: RouteResult): boolean {
  if (candidate.totalFare !== best.totalFare)
    return candidate.totalFare < best.totalFare;
  if (candidate.totalDurationSec !== best.totalDurationSec)
    return candidate.totalDurationSec < best.totalDurationSec;
  return candidate.transferCount < best.transferCount;
}
