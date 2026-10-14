import { Injectable } from '@nestjs/common';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import {
  MultiCriteriaRouteEngine,
  SearchParams,
} from './multi-criteria-route.engine';

const KM_PER_DEGREE_LAT = 110.574;
const KM_PER_DEGREE_LNG_AT_EQUATOR = 111.32;

// stations on a local flat map (km), and the fastest speed any edge of the graph allows
interface GraphGeometry {
  x: Float64Array;
  y: Float64Array;
  // km per second, 0 when no usable bound exists
  maxSpeed: number;
}

// A* with the multi-criteria cost of ADR-001, kept next to Dijkstra for the benchmark of Task 3.4.
// The heuristic is the straight-line distance to the destination divided by the fastest speed found in
// the graph. Every ride and transfer takes at least its straight-line distance over that speed, and
// congestion and transfer penalties only add cost, so the heuristic never overestimates and the cheapest
// cost stays the same as Dijkstra's.
@Injectable()
export class AStarRouteEngine extends MultiCriteriaRouteEngine {
  private readonly geometries = new WeakMap<SubwayGraph, GraphGeometry>();

  protected heuristic(
    graph: SubwayGraph,
    destination: number,
    params: SearchParams,
  ): ((station: number) => number) | undefined {
    // the 'distance' cost comes from distance tables rather than coordinates, so no straight-line bound
    if (params.metric === 'distance' || params.expressPreference)
      return undefined;
    const { x, y, maxSpeed } = this.geometryOf(graph);
    if (maxSpeed <= 0) return undefined;

    const goalX = x[destination];
    const goalY = y[destination];
    // the estimate of a station is needed when it is queued and again when it is taken off the queue,
    // so it is computed once per station and search
    const known = new Float64Array(x.length).fill(-1);
    return (station: number): number => {
      const cached = known[station];
      if (cached >= 0) return cached;
      const dx = x[station] - goalX;
      const dy = y[station] - goalY;
      const estimate = Math.sqrt(dx * dx + dy * dy) / maxSpeed;
      known[station] = estimate;
      return estimate;
    };
  }

  private geometryOf(graph: SubwayGraph): GraphGeometry {
    let geometry = this.geometries.get(graph);
    if (!geometry) {
      geometry = buildGeometry(graph);
      this.geometries.set(graph, geometry);
    }
    return geometry;
  }
}

function buildGeometry(graph: SubwayGraph): GraphGeometry {
  const count = graph.stationCount;
  let latSum = 0;
  for (let i = 0; i < count; i += 1) latSum += graph.station(i).lat;
  const kmPerDegreeLng =
    KM_PER_DEGREE_LNG_AT_EQUATOR *
    Math.cos(((count ? latSum / count : 0) * Math.PI) / 180);

  const x = new Float64Array(count);
  const y = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const station = graph.station(i);
    x[i] = station.lng * kmPerDegreeLng;
    y[i] = station.lat * KM_PER_DEGREE_LAT;
  }

  // the fastest edge or transfer, measured on the same flat map the heuristic uses
  let maxSpeed = 0;
  let bounded = true;
  const consider = (from: number, to: number, seconds: number): void => {
    const dx = x[from] - x[to];
    const dy = y[from] - y[to];
    const km = Math.sqrt(dx * dx + dy * dy);
    if (km === 0) return;
    if (seconds <= 0) {
      bounded = false;
      return;
    }
    maxSpeed = Math.max(maxSpeed, km / seconds);
  };
  for (let from = 0; from < count; from += 1) {
    for (const edge of graph.edgesFrom(from)) {
      consider(from, edge.toIndex, edge.durationSec);
    }
    for (const transfer of graph.transfersFrom(from)) {
      consider(from, transfer.toIndex, transfer.walkingDurationSec);
    }
  }
  return { x, y, maxSpeed: bounded ? maxSpeed : 0 };
}
