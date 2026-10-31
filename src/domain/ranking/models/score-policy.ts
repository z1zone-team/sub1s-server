export class ScorePolicy {
  /**
   * Score formula per PROJECT_SPEC.md [FR-04]:
   * - Score: round(distanceKm * 10)
   */
  static calculateEarnedPoints(distanceKm: number): number {
    return Math.max(0, Math.round(distanceKm * 10));
  }
}
