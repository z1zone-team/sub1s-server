import { SECONDS_PER_DAY, SERVICE_DAY_ROLLOVER_SEC } from '../../arrival/models/train-schedule';
import { kstAddDays, kstDayKey, kstStartOfDay } from '../../../common/utils/kst';
import { TrainPosition, TrainPositionStatus } from './train-position';

/** 관측을 저장하고 보관하는 기간 */
export const OBSERVATION_RETENTION_DAYS = 30;

/** 역에 있거나 막 들어오고 나간 상태. 이때의 시각을 그 역의 열차 관측으로 본다 */
const AT_STATION: ReadonlySet<TrainPositionStatus> = new Set(['ENTERING', 'ARRIVED', 'DEPARTED']);

export interface TrainObservation {
  lineId: string;
  trainNo: string;
  stationName: string;
  stationId: string | null;
  status: TrainPositionStatus;
  direction: string;
  destinationName: string;
  isLastTrain: boolean;
  observedAt: Date;
}

export interface ServiceDailyRow {
  serviceDate: string;
  stationId: string;
  direction: string;
  /** 운행일 0시 기준 초(24시 이후는 24시간을 더한 값) */
  firstSec: number;
  lastSec: number;
  samples: number;
}

/** 운행일은 04:00에 바뀐다. 새벽 4시 전은 전날 운행일이다 */
export function serviceDateOf(at: Date | number): string {
  const time = typeof at === 'number' ? at : at.getTime();
  const secondsOfDay = (time - kstStartOfDay(time).getTime()) / 1000;
  return kstDayKey(secondsOfDay < SERVICE_DAY_ROLLOVER_SEC ? kstAddDays(time, -1) : time);
}

/** 그 운행일의 시작(04:00)과 끝(다음 운행일 시작 04:00)의 시각(epoch ms) */
export function serviceDayWindow(serviceDate: string): { from: number; to: number } {
  const start = new Date(`${serviceDate}T00:00:00+09:00`).getTime();
  return {
    from: start + SERVICE_DAY_ROLLOVER_SEC * 1000,
    to: start + (SECONDS_PER_DAY + SERVICE_DAY_ROLLOVER_SEC) * 1000,
  };
}

/** 집계할 수 있는 가장 최근 운행일: 지금 운행일의 전날 */
export function previousServiceDate(now: Date | number): string {
  return kstDayKey(kstAddDays(new Date(`${serviceDateOf(now)}T12:00:00+09:00`), -1));
}

/**
 * 폴링마다 같은 열차가 같은 역, 같은 상태로 계속 잡히므로 바뀐 것만 고른다.
 * previous는 열차별로 마지막에 고른 `역|상태`이고, 이 함수가 새 값으로 갱신한다
 */
export function newObservations(
  lineId: string,
  trains: Array<TrainPosition & { stationId: string | null }>,
  observedAt: Date,
  previous: Map<string, string>,
): TrainObservation[] {
  const result: TrainObservation[] = [];
  for (const train of trains) {
    if (!train.trainNo) continue;
    const key = `${lineId}|${train.trainNo}`;
    const state = `${train.stationName}|${train.status}`;
    if (previous.get(key) === state) continue;
    previous.set(key, state);
    result.push({
      lineId,
      trainNo: train.trainNo,
      stationName: train.stationName,
      stationId: train.stationId,
      status: train.status,
      direction: train.direction,
      destinationName: train.destinationName,
      isLastTrain: train.isLastTrain,
      observedAt,
    });
  }
  return result;
}

/** 한 운행일의 관측에서 역과 방향별로 열차가 처음, 마지막으로 보인 시각(운행일 0시 기준 초)을 구한다 */
export function aggregateServiceDay(serviceDate: string, observations: TrainObservation[]): ServiceDailyRow[] {
  const startMs = new Date(`${serviceDate}T00:00:00+09:00`).getTime();
  const rows = new Map<string, ServiceDailyRow>();
  for (const observation of observations) {
    if (!observation.stationId || !AT_STATION.has(observation.status)) continue;
    const sec = Math.round((observation.observedAt.getTime() - startMs) / 1000);
    const key = `${observation.stationId}|${observation.direction}`;
    const row = rows.get(key);
    if (!row) {
      rows.set(key, {
        serviceDate,
        stationId: observation.stationId,
        direction: observation.direction,
        firstSec: sec,
        lastSec: sec,
        samples: 1,
      });
    } else {
      row.firstSec = Math.min(row.firstSec, sec);
      row.lastSec = Math.max(row.lastSec, sec);
      row.samples += 1;
    }
  }
  return [...rows.values()].sort((a, b) =>
    `${a.stationId}|${a.direction}`.localeCompare(`${b.stationId}|${b.direction}`),
  );
}
