import { SubwayRouteOptionDto } from '../../../application/route/dto/route-search-response.dto';

export type DeviationReason =
  'ON_ROUTE' | 'SUSPECTED_DEVIATION' | 'USER_CONFIRMED' | 'CONFIRMED_OFFROUTE';

export type OffRouteAlertReason = 'WRONG_DIRECTION' | 'SKIPPED_TRANSFER';

export interface DeviationResult {
  shouldReroute: boolean;
  needsUserConfirmation?: boolean;
  reason: DeviationReason;
}

export interface TrackingSession {
  sessionId: string;
  userId: string;
  routeOption: SubwayRouteOptionDto;
  allStationIds: string[];
  originStationId: string;
  destStationId: string;
  currentStationId: string;
  nextStationId: string;
  expectedRemainingStationIds: string[];
  remainingDurationSec: number;
  isOffRoute: boolean;
  createdAt: Date;
  updatedAt: Date;
}
