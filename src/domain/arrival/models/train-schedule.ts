import { TrainDirection } from '../ports/INextTrainProvider';

export type ServiceDayType = 'weekday' | 'holiday';

/** [방향, 행선지, 급행 여부(0 또는 1), 운행일 0시 기준 출발 시각(초) 오름차순] */
export type ScheduleGroup = [TrainDirection, string, 0 | 1, number[]];

export interface TrainScheduleFile {
  dayTypes: Record<ServiceDayType, Record<string, ScheduleGroup[]>>;
}

/** 새벽 운행분은 전날 운행일의 연장이라 24시 이후 시각으로 센다 */
export const SERVICE_DAY_ROLLOVER_SEC = 4 * 60 * 60;
export const SECONDS_PER_DAY = 24 * 60 * 60;

export function toServiceSeconds(secondsOfDay: number): number {
  return secondsOfDay < SERVICE_DAY_ROLLOVER_SEC
    ? secondsOfDay + SECONDS_PER_DAY
    : secondsOfDay;
}
