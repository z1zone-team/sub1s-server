export class ScorePolicy {
  /**
   * Score formula per PROJECT_SPEC.md [FR-04]:
   * - Base score: round(distanceKm * 10)
   * - On-time bonus: +20 points when within +-5 minutes of scheduled arrival
   */
  static calculateEarnedPoints(distanceKm: number, isOnTime = false): number {
    const baseScore = Math.max(0, Math.round(distanceKm * 10));
    const bonus = isOnTime ? 20 : 0;
    return baseScore + bonus;
  }
}
