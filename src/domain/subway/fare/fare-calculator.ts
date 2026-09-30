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

export type LineSurcharge = FlatLineSurcharge | SegmentLineSurcharge;

export interface FareRule {
  effectiveFrom: string;
  baseFare: number;
  baseDistanceKm: number;
  tiers: FareTier[];
  lineSurcharges?: LineSurcharge[];
}

export interface RiddenEdge {
  lineId: string;
  fromStationId: string;
  toStationId: string;
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
): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error(`invalid distance: ${distanceKm}`);
  }
  let fare = rule.baseFare;
  for (const tier of rule.tiers) {
    if (distanceKm <= tier.fromKm) continue;
    const covered = Math.min(distanceKm, tier.toKm ?? Infinity) - tier.fromKm;
    fare += Math.ceil(covered / tier.stepKm) * tier.stepFare;
  }
  for (const surcharge of rule.lineSurcharges ?? []) {
    if (surcharge.type === 'flat') {
      if (edges.some((edge) => edge.lineId === surcharge.lineId)) {
        fare += surcharge.fare;
      }
    } else {
      fare += segmentSurcharge(surcharge, edges);
    }
  }
  return fare;
}
