export interface FareTier {
  fromKm: number;
  toKm?: number;
  stepKm: number;
  stepFare: number;
}

export interface FlatLineSurcharge {
  type: 'flat';
  lineId: string;
  fare: number;
}

// a line whose surcharge depends on which of its segments the trip passes through
export interface SegmentLineSurcharge {
  type: 'segments';
  lineId: string;
  segments: { key: string; stationIds: string[] }[];
  fares: Record<string, number>;
}

// a line with its own base fare and distance step on top of the integrated fare (e.g. GTX-A)
export interface LineDistanceSurcharge {
  type: 'lineDistance';
  lineId: string;
  baseFare: { weekday: number; weekend: number };
  baseDistanceKm: number;
  stepKm: number;
  stepFare: number;
}

export type LineSurcharge =
  FlatLineSurcharge | SegmentLineSurcharge | LineDistanceSurcharge;

// official station-to-station fares for trips that stay on one line (key: sorted station ids joined by '|')
export interface PairFareTable {
  lineId: string;
  source?: string;
  fares: Record<string, number>;
}

// a zone with its own fare that is added to the integrated fare (e.g. AREX 청라국제도시 ~ 인천공항2터미널)
export interface IndependentZone {
  lineId: string;
  boundaryStationId: string;
  stationFares: Record<string, number>;
}

export interface FareRule {
  effectiveFrom: string;
  baseFare: number;
  baseDistanceKm: number;
  tiers: FareTier[];
  lineSurcharges?: LineSurcharge[];
  pairFares?: PairFareTable[];
  independentZones?: IndependentZone[];
}

export interface FareOptions {
  weekend?: boolean;
}

export interface RiddenEdge {
  lineId: string;
  fromStationId: string;
  toStationId: string;
  distanceKm?: number;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function distanceOf(edge: RiddenEdge): number {
  if (edge.distanceKm === undefined) {
    throw new Error(
      `distanceKm is required for edge ${edge.fromStationId}-${edge.toStationId}`,
    );
  }
  return edge.distanceKm;
}

function segmentSurcharge(
  surcharge: SegmentLineSurcharge,
  edges: RiddenEdge[],
): number {
  const used = new Set<string>();
  for (const edge of edges) {
    if (edge.lineId !== surcharge.lineId) continue;
    const segment = surcharge.segments.find(
      (s) =>
        s.stationIds.includes(edge.fromStationId) &&
        s.stationIds.includes(edge.toStationId),
    );
    if (!segment) {
      throw new Error(
        `edge ${edge.fromStationId}-${edge.toStationId} is not in a ${surcharge.lineId} fare segment`,
      );
    }
    used.add(segment.key);
  }
  if (used.size === 0) return 0;
  const key = [...used].sort().join('+');
  const fare = surcharge.fares[key];
  if (fare === undefined) {
    throw new Error(
      `no ${surcharge.lineId} surcharge defined for segments ${key}`,
    );
  }
  return fare;
}

// Adult transit-card fare of the Seoul metropolitan integrated fare system.
// The travel distance is summed across transfers, every started step adds the step fare,
// and lines with a separate fare add their surcharge when the trip rides them.
export function calculateFare(
  distanceKm: number,
  rule: FareRule,
  edges: RiddenEdge[] = [],
  options: FareOptions = {},
): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error(`invalid distance: ${distanceKm}`);
  }

  // trips that stay on one line use the official station-to-station table
  for (const table of rule.pairFares ?? []) {
    if (edges.length > 0 && edges.every((e) => e.lineId === table.lineId)) {
      const key = pairKey(
        edges[0].fromStationId,
        edges[edges.length - 1].toStationId,
      );
      const fare = table.fares[key];
      if (fare === undefined)
        throw new Error(`no ${table.lineId} fare for ${key}`);
      return fare;
    }
  }

  // independent zones are charged separately and are left out of the integrated distance
  let integratedDistance = distanceKm;
  let zoneFare = 0;
  for (const zone of rule.independentZones ?? []) {
    const zoneStations = new Set([
      zone.boundaryStationId,
      ...Object.keys(zone.stationFares),
    ]);
    const zoneEdges = edges.filter(
      (e) =>
        e.lineId === zone.lineId &&
        zoneStations.has(e.fromStationId) &&
        zoneStations.has(e.toStationId),
    );
    if (zoneEdges.length === 0) continue;
    const visited = new Set(
      zoneEdges.flatMap((e) => [e.fromStationId, e.toStationId]),
    );
    zoneFare += Math.max(
      ...[...visited].map((id) => zone.stationFares[id] ?? 0),
    );
    integratedDistance -= zoneEdges.reduce((sum, e) => sum + distanceOf(e), 0);
  }

  let fare = rule.baseFare;
  for (const tier of rule.tiers) {
    if (integratedDistance <= tier.fromKm) continue;
    const covered =
      Math.min(integratedDistance, tier.toKm ?? Infinity) - tier.fromKm;
    fare += Math.ceil(covered / tier.stepKm) * tier.stepFare;
  }
  fare += zoneFare;

  for (const surcharge of rule.lineSurcharges ?? []) {
    if (surcharge.type === 'flat') {
      if (edges.some((edge) => edge.lineId === surcharge.lineId)) {
        fare += surcharge.fare;
      }
    } else if (surcharge.type === 'segments') {
      fare += segmentSurcharge(surcharge, edges);
    } else {
      const ridden = edges.filter((e) => e.lineId === surcharge.lineId);
      if (ridden.length === 0) continue;
      const lineKm = ridden.reduce((sum, e) => sum + distanceOf(e), 0);
      const base = options.weekend
        ? surcharge.baseFare.weekend
        : surcharge.baseFare.weekday;
      const steps =
        lineKm > surcharge.baseDistanceKm
          ? Math.ceil((lineKm - surcharge.baseDistanceKm) / surcharge.stepKm)
          : 0;
      fare += base + steps * surcharge.stepFare;
    }
  }
  return fare;
}
