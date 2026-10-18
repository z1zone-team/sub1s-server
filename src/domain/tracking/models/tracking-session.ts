import { ChoiceSnapshot } from '../../subway/models/preference-model';
import { RouteMode } from '../../subway/models/route';

/** 추적이 경로에서 읽는 구간 정보. 경로 응답 DTO의 일부와 같은 모양이라 DTO를 그대로 넣을 수 있다 */
export interface TrackedRouteSegment {
  fromStationId: string;
  toStationId: string;
  lineId: string;
  /** 이 구간이 끝나는 역에서 내리거나 환승할 때 추천하는 도어. 경로 응답의 값이며 없을 수 있다 */
  recommendedDoors?: string[];
}

/** 추적 세션이 기억하는 경로. 추적이 쓰는 필드만 둔다(경로 응답 DTO 전체를 도메인이 알 필요가 없다) */
export interface TrackedRoute {
  mode: RouteMode;
  totalDurationSec: number;
  totalDistanceKm?: number;
  transferCount?: number;
  routeId?: string;
  segments: TrackedRouteSegment[];
}

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
  routeOption: TrackedRoute;
  choiceSnapshot?: ChoiceSnapshot;
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
  /** 이미 보낸 smart_alert의 키(`종류:구간 번호`). 같은 알림을 두 번 보내지 않는다 */
  sentAlertKeys?: string[];
  createdAt: Date;
  updatedAt: Date;
}
