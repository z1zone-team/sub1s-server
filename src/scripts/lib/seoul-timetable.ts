import { ScheduleGroup, toServiceSeconds } from '../../domain/arrival/models/train-schedule';
import { TrainDirection } from '../../domain/arrival/ports/INextTrainProvider';

/** 서울 열린데이터광장 SearchSTNTimeTableByIDService 응답의 행 중 쓰는 필드 */
export interface SeoulTimetableRow {
  FR_CODE: string;
  STATION_CD: string;
  STATION_NM: string;
  ARRIVETIME?: string | null;
  LEFTTIME?: string | null;
  /** 도착(종착)역 이름 */
  SUBWAYENAME?: string | null;
  /** 1 상행/내선, 2 하행/외선 */
  INOUT_TAG: string;
  /** G 일반, 그 밖은 급행·직행 */
  EXPRESS_YN?: string | null;
}

/** "05:35:30", 자정 넘은 "24:46:00"을 초로. 형식이 다르거나 비어 있거나 00:00:00이면 null */
export function parseClockSeconds(value?: string | null): number | null {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) return null;
  const [hours, minutes, seconds] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (hours >= 30 || minutes >= 60 || seconds >= 60) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total === 0 ? null : total;
}

/**
 * 한 역의 시간표 행을 방향, 행선지, 급행별 출발 시각 목록으로 만든다. 출발 시각이 없는 행(그 역이 종착이라 내리기만 하는 열차)은 뺀다.
 * directionOf는 INOUT_TAG를 이 노선의 방향으로 바꾸고, 모르면 undefined를 돌려 그 행을 뺀다
 */
export function buildSeoulGroups(
  rows: SeoulTimetableRow[],
  directionOf: (inoutTag: string) => TrainDirection | undefined,
): ScheduleGroup[] {
  const groups = new Map<string, ScheduleGroup>();
  for (const row of rows) {
    const direction = directionOf(row.INOUT_TAG);
    const departure = parseClockSeconds(row.LEFTTIME);
    const headsign = (row.SUBWAYENAME ?? '').trim();
    if (!direction || departure === null || !headsign) continue;

    const express: 0 | 1 = (row.EXPRESS_YN ?? 'G').trim().toUpperCase() === 'G' ? 0 : 1;
    const key = `${direction}|${headsign}|${express}`;
    const group = groups.get(key) ?? [direction, headsign, express, []];
    groups.set(key, group);
    group[3].push(toServiceSeconds(departure));
  }

  return [...groups.values()]
    .map((group): ScheduleGroup => [group[0], group[1], group[2], [...new Set(group[3])].sort((a, b) => a - b)])
    .sort((a, b) => `${a[0]}|${a[1]}|${a[2]}`.localeCompare(`${b[0]}|${b[1]}|${b[2]}`));
}
