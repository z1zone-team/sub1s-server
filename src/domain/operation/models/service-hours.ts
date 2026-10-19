import { ScheduleGroup } from '../../arrival/models/train-schedule';

export type ServiceHoursStatus = 'BEFORE_FIRST_TRAIN' | 'AFTER_LAST_TRAIN';

export interface ServiceWindow {
  /** 운행일 0시 기준 초(24시 이후는 24시간을 더한 값). 이 역에서 이 방향의 첫차 출발 */
  firstTrainSec: number;
  lastTrainSec: number;
}

/** 이 역에서 이 방향으로 가는 열차의 첫차와 막차. 행선지와 급행은 가리지 않는다. 이 방향의 열차가 없으면 null */
export function serviceWindowOf(groups: ScheduleGroup[] | undefined, direction: string): ServiceWindow | null {
  let first = Infinity;
  let last = -Infinity;
  for (const [groupDirection, , , times] of groups ?? []) {
    if (groupDirection !== direction || times.length === 0) continue;
    first = Math.min(first, times[0]);
    last = Math.max(last, times[times.length - 1]);
  }
  return Number.isFinite(first) ? { firstTrainSec: first, lastTrainSec: last } : null;
}

/** 탑승역에 이 시각(운행일 기준 초)에 도착하면 탈 수 있는 열차가 있는지. 첫차 전이면 BEFORE_FIRST_TRAIN, 막차 뒤이면 AFTER_LAST_TRAIN, 탈 수 있으면 null */
export function checkBoarding(window: ServiceWindow, boardingSec: number): ServiceHoursStatus | null {
  if (boardingSec < window.firstTrainSec) return 'BEFORE_FIRST_TRAIN';
  if (boardingSec > window.lastTrainSec) return 'AFTER_LAST_TRAIN';
  return null;
}
