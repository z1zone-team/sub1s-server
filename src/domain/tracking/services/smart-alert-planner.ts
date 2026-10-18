import { TrackingSession } from '../models/tracking-session';

export type SmartAlertType =
  'TRANSFER_PREPARE' | 'TRANSFER_NOW' | 'ALIGHT_PREPARE';

export interface PlannedSmartAlert {
  /** 세션 안에서 알림을 가리는 키. 같은 키는 한 번만 보낸다 */
  key: string;
  type: SmartAlertType;
  /** 알림이 가리키는 역(환승역 또는 하차역) */
  stationId: string;
  /** 추천 도어. 모르면 빈 문자열 */
  door: string;
}

const WALK_LINE_ID = 'WALK';

type PlannerSession = Pick<
  TrackingSession,
  'allStationIds' | 'currentStationId' | 'routeOption' | 'sentAlertKeys'
>;

/**
 * 현재 역이 환승 또는 하차 한 역 전인지 경로와 비교해 지금 보내야 할 알림을 계산한다.
 * - 환승 한 역 전: TRANSFER_PREPARE, 환승역에 도착: TRANSFER_NOW, 마지막 구간의 하차 한 역 전: ALIGHT_PREPARE
 * 이미 보낸 알림(`sentAlertKeys`)은 뺀다
 */
export function planSmartAlerts(session: PlannerSession): PlannedSmartAlert[] {
  const stationIds = session.allStationIds;
  const current = stationIds.indexOf(session.currentStationId);
  if (current < 0) return [];

  const rides = session.routeOption.segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.lineId !== WALK_LINE_ID);
  const sent = new Set(session.sentAlertKeys ?? []);
  const planned: PlannedSmartAlert[] = [];

  let searchFrom = 0;
  rides.forEach(({ segment, index }, order) => {
    const end = stationIds.indexOf(segment.toStationId, searchFrom);
    if (end < 0) return;
    searchFrom = end;

    const next = rides[order + 1]?.segment;
    const isLast = next === undefined;
    const nextStart = next
      ? stationIds.indexOf(next.fromStationId, end)
      : -1;
    const door = segment.recommendedDoors?.[0] ?? '';

    let type: SmartAlertType | undefined;
    if (current === end - 1) {
      type = isLast ? 'ALIGHT_PREPARE' : 'TRANSFER_PREPARE';
    } else if (!isLast && (current === end || current === nextStart)) {
      type = 'TRANSFER_NOW';
    }
    if (!type) return;

    const key = `${type}:${index}`;
    if (sent.has(key)) return;
    planned.push({ key, type, stationId: segment.toStationId, door });
  });
  return planned;
}
