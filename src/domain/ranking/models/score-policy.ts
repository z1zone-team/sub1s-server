export interface ScoreBreakdown {
  distancePoints: number;
  onTimeBonus: number;
  earnedPoints: number;
}

export class ScorePolicy {
  static readonly ON_TIME_BONUS = 20;

  /**
   * Score formula per PROJECT_SPEC.md [FR-04]:
   * - Base score: round(distanceKm * 10)
   * - On-time bonus: +20 points when within +-5 minutes of scheduled arrival
   */
  static calculateBreakdown(
    distanceKm: number,
    isOnTime = false,
  ): ScoreBreakdown {
    const distancePoints = Math.max(0, Math.round(distanceKm * 10));
    const onTimeBonus = isOnTime ? ScorePolicy.ON_TIME_BONUS : 0;
    return {
      distancePoints,
      onTimeBonus,
      earnedPoints: distancePoints + onTimeBonus,
    };
  }

  static calculateEarnedPoints(distanceKm: number, isOnTime = false): number {
    return ScorePolicy.calculateBreakdown(distanceKm, isOnTime).earnedPoints;
  }
}
