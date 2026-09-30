export interface FareTier {
  fromKm: number;
  toKm?: number;
  stepKm: number;
  stepFare: number;
}

export interface FareRule {
  effectiveFrom: string;
  baseFare: number;
  baseDistanceKm: number;
  tiers: FareTier[];
}

// Adult transit-card fare of the Seoul metropolitan integrated fare system.
// The travel distance is summed across transfers, and every started step adds the step fare.
export function calculateFare(distanceKm: number, rule: FareRule): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error(`invalid distance: ${distanceKm}`);
  }
  let fare = rule.baseFare;
  for (const tier of rule.tiers) {
    if (distanceKm <= tier.fromKm) continue;
    const covered = Math.min(distanceKm, tier.toKm ?? Infinity) - tier.fromKm;
    fare += Math.ceil(covered / tier.stepKm) * tier.stepFare;
  }
  return fare;
}
