import { distanceKm } from './subway-common';

export interface StationPoint {
  id: string;
  lat: number;
  lng: number;
}

export interface Segment {
  lineId: string;
  fromStationId: string;
  toStationId: string;
  distanceKm: number;
  durationSec: number;
}

// stations of one path in 상행 -> 하행 order; a loop closes from the last station back to the first
export interface LinePath {
  lineId: string;
  stationIds: string[];
  loop?: boolean;
}

export type EdgeDirection = 'UP' | 'DOWN' | 'INNER' | 'OUTER';

export interface EdgeOut {
  fromStationId: string;
  toStationId: string;
  lineId: string;
  direction: EdgeDirection;
  isExpress: boolean;
  distanceKm: number;
  durationSec: number;
  isEstimated: boolean;
}

export interface Calibration {
  circuity: number;
  speedKmh: number;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// estimation constants come from the measured segments, not from assumptions
export function calibrate(
  segments: Segment[],
  stations: StationPoint[],
): Calibration {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const ratios: number[] = [];
  let totalKm = 0;
  let totalSec = 0;
  for (const segment of segments) {
    const from = byId.get(segment.fromStationId);
    const to = byId.get(segment.toStationId);
    if (!from || !to) continue;
    const geo = distanceKm(from.lat, from.lng, to.lat, to.lng);
    if (geo > 0) ratios.push(segment.distanceKm / geo);
    totalKm += segment.distanceKm;
    totalSec += segment.durationSec;
  }
  if (ratios.length === 0 || totalSec === 0)
    throw new Error('no measured segments to calibrate from');
  return { circuity: median(ratios), speedKmh: totalKm / (totalSec / 3600) };
}

// lineSeq is unique per line: numbered along the paths in order, a shared junction keeps its first number
export function assignLineSeq(paths: LinePath[]): Map<string, number> {
  const seqByStation = new Map<string, number>();
  const nextByLine = new Map<string, number>();
  for (const path of paths) {
    for (const stationId of path.stationIds) {
      if (seqByStation.has(stationId)) continue;
      const next = (nextByLine.get(path.lineId) ?? 0) + 1;
      nextByLine.set(path.lineId, next);
      seqByStation.set(stationId, next);
    }
  }
  return seqByStation;
}

export function buildEdges(
  paths: LinePath[],
  segments: Segment[],
  stations: StationPoint[],
  calibration: Calibration,
): EdgeOut[] {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const measured = new Map(
    segments.map((s) => [pairKey(s.fromStationId, s.toStationId), s]),
  );
  const edges = new Map<string, EdgeOut>();

  const add = (
    lineId: string,
    from: string,
    to: string,
    forward: boolean,
    loop: boolean,
  ): void => {
    const fromId = from;
    const toId = to;
    const key = `${fromId}>${toId}`;
    if (edges.has(key)) return;
    const known = measured.get(pairKey(from, to));
    const a = byId.get(from);
    const b = byId.get(to);
    if (!known && (!a || !b))
      throw new Error(`station not found for edge ${from} - ${to}`);
    const geo = a && b ? distanceKm(a.lat, a.lng, b.lat, b.lng) : 0;
    const estimatedKm = Math.round(geo * calibration.circuity * 100) / 100;
    const distance = known ? known.distanceKm : estimatedKm;
    const direction: EdgeDirection = loop
      ? forward
        ? 'INNER'
        : 'OUTER'
      : forward
        ? 'DOWN'
        : 'UP';
    edges.set(key, {
      fromStationId: fromId,
      toStationId: toId,
      lineId,
      direction,
      isExpress: false,
      distanceKm: distance,
      durationSec: known
        ? known.durationSec
        : Math.round((distance / calibration.speedKmh) * 3600),
      isEstimated: !known,
    });
  };

  for (const path of paths) {
    const ids = path.stationIds;
    const last = path.loop ? ids.length : ids.length - 1;
    for (let i = 0; i < last; i += 1) {
      const from = ids[i];
      const to = ids[(i + 1) % ids.length];
      add(path.lineId, from, to, true, path.loop === true);
      add(path.lineId, to, from, false, path.loop === true);
    }
  }
  return [...edges.values()];
}
