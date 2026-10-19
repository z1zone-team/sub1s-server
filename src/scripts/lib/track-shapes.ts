import { LatLng } from '../../common/utils/polyline';
import { OsmWay } from './osm-railways';

export interface TrackGraph {
  points: LatLng[];
  adjacency: { to: number; meters: number }[][];
  grid: Map<string, number[]>;
}

const CELL_DEG = 0.002;
const EARTH_M = 6371000;

export function meters(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

const cellOf = (lat: number, lng: number): string => `${Math.floor(lat / CELL_DEG)},${Math.floor(lng / CELL_DEG)}`;

/** OSM 선로를 그래프로 만든다. 같은 좌표의 점은 한 점으로 합치고(교차, 분기) 선로 방향은 가리지 않는다 */
export function buildTrackGraph(ways: OsmWay[]): TrackGraph {
  const index = new Map<string, number>();
  const points: LatLng[] = [];
  const adjacency: { to: number; meters: number }[][] = [];

  const nodeOf = (lat: number, lng: number): number => {
    const key = `${lat.toFixed(7)},${lng.toFixed(7)}`;
    const found = index.get(key);
    if (found !== undefined) return found;
    points.push({ lat, lng });
    adjacency.push([]);
    index.set(key, points.length - 1);
    return points.length - 1;
  };

  for (const way of ways) {
    for (let i = 1; i < way.geometry.length; i += 1) {
      const a = nodeOf(way.geometry[i - 1].lat, way.geometry[i - 1].lon);
      const b = nodeOf(way.geometry[i].lat, way.geometry[i].lon);
      if (a === b) continue;
      const m = meters(points[a], points[b]);
      adjacency[a].push({ to: b, meters: m });
      adjacency[b].push({ to: a, meters: m });
    }
  }

  const grid = new Map<string, number[]>();
  points.forEach((p, i) => {
    const key = cellOf(p.lat, p.lng);
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  });
  return { points, adjacency, grid };
}

/** 가까운 선로 점 후보. 상하행 선로가 따로 그려진 역을 위해 거리순으로 여러 개를 준다 */
export function nearestNodes(graph: TrackGraph, at: LatLng, maxMeters: number, limit: number): number[] {
  const ci = Math.floor(at.lat / CELL_DEG);
  const cj = Math.floor(at.lng / CELL_DEG);
  const found: { index: number; meters: number }[] = [];
  for (let di = -2; di <= 2; di += 1) {
    for (let dj = -2; dj <= 2; dj += 1) {
      for (const index of graph.grid.get(`${ci + di},${cj + dj}`) ?? []) {
        const m = meters(at, graph.points[index]);
        if (m <= maxMeters) found.push({ index, meters: m });
      }
    }
  }
  return found
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit)
    .map((f) => f.index);
}

/** 최단 선로 경로(점 번호 목록). maxMeters보다 멀면 찾지 않는다 */
export function shortestPath(graph: TrackGraph, from: number, to: number, maxMeters: number): number[] | undefined {
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const heap: [number, number][] = [[0, from]];
  const push = (item: [number, number]): void => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop() as [number, number];
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]];
        i = s;
      }
    }
    return top;
  };

  while (heap.length > 0) {
    const [d, node] = pop();
    if (d > (dist.get(node) ?? Infinity)) continue;
    if (node === to) {
      const path = [to];
      while (path[0] !== from) path.unshift(prev.get(path[0]) as number);
      return path;
    }
    for (const edge of graph.adjacency[node]) {
      const next = d + edge.meters;
      if (next > maxMeters || next >= (dist.get(edge.to) ?? Infinity)) continue;
      dist.set(edge.to, next);
      prev.set(edge.to, node);
      push([next, edge.to]);
    }
  }
  return undefined;
}

/** 점 p에서 선분 ab까지의 거리(m) */
function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const cos = Math.cos((a.lat * Math.PI) / 180);
  const toXY = (q: LatLng): [number, number] => [(q.lng - a.lng) * 111320 * cos, (q.lat - a.lat) * 110540];
  const [px, py] = toXY(p);
  const [bx, by] = toXY(b);
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - bx * t, py - by * t);
}

/** Douglas-Peucker 단순화. toleranceM 이하의 꺾임은 펴 준다 */
export function simplify(points: LatLng[], toleranceM: number): LatLng[] {
  if (points.length <= 2) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let worst = -1;
    let worstDistance = toleranceM;
    for (let i = start + 1; i < end; i += 1) {
      const d = distanceToSegment(points[i], points[start], points[end]);
      if (d > worstDistance) {
        worstDistance = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = true;
      stack.push([start, worst], [worst, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function pathLength(points: LatLng[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) sum += meters(points[i - 1], points[i]);
  return sum;
}

export interface ShapeLimits {
  /** 역에서 이 거리 안의 선로 점만 후보로 본다 */
  snapMeters: number;
  /** 역마다 후보로 보는 선로 점 수 */
  candidates: number;
  /** 선로 길이는 직선 거리의 이 배수 이하여야 한다 */
  maxRatio: number;
  /** 직선 거리에 더해 허용하는 여유(m) */
  slackMeters: number;
  /** 선로가 두 역을 잇는 직선에서 벗어나도 되는 거리(직선 거리의 비율)와 여유(m) */
  maxDeviationRatio: number;
  deviationSlackMeters: number;
  simplifyMeters: number;
}

export const DEFAULT_LIMITS: ShapeLimits = {
  snapMeters: 120,
  candidates: 4,
  maxRatio: 1.6,
  slackMeters: 300,
  maxDeviationRatio: 0.5,
  deviationSlackMeters: 150,
  simplifyMeters: 3,
};

/**
 * 두 역 사이 선로를 따라가는 좌표열. 양 끝에 역 좌표를 붙여 이어 붙였을 때 역 점에서 연결되게 한다.
 * 선로를 찾지 못하거나 직선 거리와 너무 다르면(다른 노선 선로로 샌 경우) undefined다
 */
export function trackShape(
  graph: TrackGraph,
  a: LatLng,
  b: LatLng,
  limits: ShapeLimits = DEFAULT_LIMITS,
): LatLng[] | undefined {
  const straight = meters(a, b);
  if (straight === 0) return undefined;
  const fromNodes = nearestNodes(graph, a, limits.snapMeters, limits.candidates);
  const toNodes = nearestNodes(graph, b, limits.snapMeters, limits.candidates);
  const maxPath = straight * limits.maxRatio + limits.slackMeters;

  let best: LatLng[] | undefined;
  let bestLength = Infinity;
  for (const from of fromNodes) {
    for (const to of toNodes) {
      if (from === to) continue;
      const path = shortestPath(graph, from, to, maxPath);
      if (!path) continue;
      const points = path.map((i) => graph.points[i]);
      const length = pathLength(points);
      if (length >= bestLength) continue;
      const deviation = Math.max(...points.map((p) => distanceToSegment(p, a, b)));
      if (deviation > straight * limits.maxDeviationRatio + limits.deviationSlackMeters) continue;
      best = points;
      bestLength = length;
    }
  }
  if (!best) return undefined;
  return simplify([a, ...best, b], limits.simplifyMeters);
}
