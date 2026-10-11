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
  /** 경로에 없는 역이 연달아 감지된 횟수. 경로 위의 역이 감지되면 0으로 돌아간다 */
  offRouteMisses?: number;
  createdAt: Date;
  updatedAt: Date;
}
