import { Inject, Injectable } from '@nestjs/common';
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
interface SearchParams {
  metric: 'time' | 'distance';
  congestion: number;
  transferSec: number;
  blockedPairs?: Set<number>;
  blockedLines?: Set<string>;
  departureMs: number;
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

@Injectable()
export class DijkstraRouteEngine implements ISubwayRouteEngine {
  constructor(
    @Inject(SUBWAY_GRAPH_SOURCE) private readonly source: SubwayGraphSource,
    @Inject(CONGESTION_PROVIDER)
    private readonly congestion: ICongestionProvider,
    @Inject(FARE_RULE) private readonly fareRule: FareRule,
  ) {}

  findRoute(query: RouteQuery): Promise<RouteResult> {
    try {
      return Promise.resolve(this.search(query));
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  private search(query: RouteQuery): RouteResult {
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

    if (query.mode === 'CHEAPEST') {
      return this.findCheapest(
        graph,
        origin,
        destination,
        query,
        blockedPairs,
        departureMs,
      );
    }

    const weights = this.weightsFor(query);
    const steps = this.dijkstra(graph, origin, destination, {
      metric: 'time',
      congestion: weights.congestion,
      transferSec: weights.transferSec,
      blockedPairs,
      departureMs,
    });
    if (!steps) throw new RouteNotFoundError();
    return this.toResult(graph, steps, query.mode, query.weekend);
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
    if (query.mode === 'CHEAPEST') {
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
  ): RouteResult {
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
    let best: RouteResult | undefined;
    let fareError: Error | undefined;
    for (const params of candidates) {
      const steps = this.dijkstra(graph, origin, destination, params);
      if (!steps) continue;
      const signature = steps
        .map((s) => `${s.from}:${s.isTransfer ? 't' : 'r'}${s.link}`)
        .join(',');
      if (seen.has(signature)) continue;
      seen.add(signature);

      let result: RouteResult;
      try {
        result = this.toResult(graph, steps, 'CHEAPEST', query.weekend);
      } catch (error) {
        fareError = error as Error;
        continue;
      }
      if (!best || isCheaper(result, best)) best = result;
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

  // Standard Dijkstra over per-line station nodes. Every relaxation needs a strictly smaller cost,
  // so loops (line 2) and repeated visits cannot enqueue forever.
  private dijkstra(
    graph: SubwayGraph,
    origin: number,
    destination: number,
    params: SearchParams,
  ): Step[] | undefined {
    const count = graph.stationCount;
    const dist = new Float64Array(count).fill(Infinity);
    const prevNode = new Int32Array(count).fill(-1);
    const prevLink = new Int32Array(count).fill(-1);
    const prevIsTransfer = new Uint8Array(count);
    // physical seconds spent when reaching each station by its cheapest path, used to look up the
    // congestion at the time of riding
    const elapsedSec = new Float64Array(count);
    const queue = new MinPriorityQueue(256);

    dist[origin] = 0;
    queue.push(origin, 0);

    while (queue.size > 0) {
      const current = queue.pop();
      const currentCost = queue.lastPriority;
      if (currentCost > dist[current]) continue;
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
        queue.push(edge.toIndex, next);
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
        queue.push(transfer.toIndex, next);
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
    return steps.reverse();
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
        transfers.push({
          fromStationId: fromId,
          toStationId: toId,
          walkingDurationSec: transfer.walkingDurationSec,
        });
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
