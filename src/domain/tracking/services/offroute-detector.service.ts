import { Injectable } from '@nestjs/common';
import { DeviationResult } from '../models/tracking-session';

@Injectable()
export class OffRouteDetector {
  /**
   * Evaluates deviation based on expected route stations and detected location.
   * - If user confirmed reroute -> triggers immediate reroute
   * - If detected station is on route -> stays on route
   * - If detected station deviates from route -> triggers reroute
   */
  evaluateDeviation(
    expectedRemainingStationIds: string[],
    currentStationId: string,
    detectedStationId: string,
    isUserConfirmed = false,
  ): DeviationResult {
    if (isUserConfirmed) {
      return { shouldReroute: true, reason: 'USER_CONFIRMED' };
    }

    if (
      detectedStationId === currentStationId ||
      expectedRemainingStationIds.includes(detectedStationId)
    ) {
      return { shouldReroute: false, reason: 'ON_ROUTE' };
    }

    return {
      shouldReroute: true,
      needsUserConfirmation: false,
      reason: 'CONFIRMED_OFFROUTE',
    };
  }
}
