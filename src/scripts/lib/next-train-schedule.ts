import {
  ScheduleGroup,
  toServiceSeconds,
} from '../../domain/arrival/models/train-schedule';
import { TrainDirection } from '../../domain/arrival/ports/INextTrainProvider';
import { KricTimetableRow, parseTimeToSeconds } from './kric-timetable';

export interface ResolvedStation {
  id: string;
  stationName: string;
}

export interface ScheduleContext {
  /** `${railOprIsttCd}_${lnCd}_${stinCd}`로 우리 역을 찾는다 */
  resolveStation: (kricKey: string) => ResolvedStation | undefined;
  /** 인접한 두 역 사이 간선의 방향. 간선이 없으면 undefined */
  edgeDirection: (fromId: string, toId: string) => TrainDirection | undefined;
}

interface Stop {
  station: ResolvedStation;
  arrivalSec: number | null;
  departureSec: number | null;
  sortSec: number;
  isExpress: boolean;
}

export function kricStationKey(row: {
  railOprIsttCd: string;
  lnCd: string;
  stinCd: string;
}): string {
  return `${row.railOprIsttCd}_${row.lnCd}_${row.stinCd}`;
}

function groupByTrain(rows: KricTimetableRow[]): Map<string, KricTimetableRow[]> {
  const trains = new Map<string, KricTimetableRow[]>();
  for (const row of rows) {
    const key = `${row.railOprIsttCd}|${row.lnCd}|${row.trnNo}`;
    const list = trains.get(key);
    if (list) list.push(row);
    else trains.set(key, [row]);
  }
  return trains;
}

// 급행의 통과역은 도착 시각이 비어 있어 정차역에서 뺀다
function stopsOf(rows: KricTimetableRow[], context: ScheduleContext): Stop[] {
  const stops: Stop[] = [];
  for (const row of rows) {
    const station = context.resolveStation(kricStationKey(row));
    const arrivalSec = parseTimeToSeconds(row.arvTm);
    const departureSec = parseTimeToSeconds(row.dptTm);
    const representative = departureSec ?? arrivalSec;
    if (!station || representative === null) continue;
    stops.push({
      station,
      arrivalSec,
      departureSec,
      sortSec: toServiceSeconds(representative),
      isExpress: Boolean(row.exptCd),
    });
  }
  stops.sort((a, b) => a.sortSec - b.sortSec);

  return stops.filter((stop, index) => {
    if (!stop.isExpress) return true;
    return (
      (stop.arrivalSec !== null && stop.departureSec !== null) ||
      (index === 0 && stop.departureSec !== null) ||
      (index === stops.length - 1 && stop.arrivalSec !== null)
    );
  });
}

function majorityDirection(
  stops: Stop[],
  context: ScheduleContext,
): TrainDirection | undefined {
  const votes = new Map<TrainDirection, number>();
  for (let i = 0; i < stops.length - 1; i += 1) {
    const direction = context.edgeDirection(stops[i].station.id, stops[i + 1].station.id);
    if (direction) votes.set(direction, (votes.get(direction) ?? 0) + 1);
  }
  let best: TrainDirection | undefined;
  for (const [direction, count] of votes) {
    if (!best || count > (votes.get(best) ?? 0)) best = direction;
  }
  return best;
}

/** 열차마다 마지막 정차역을 행선지로, 간선 방향의 다수결을 방향으로 삼아 역별 출발 시각을 모은다 */
export function buildStationSchedules(
  rows: KricTimetableRow[],
  context: ScheduleContext,
): Map<string, ScheduleGroup[]> {
  const collected = new Map<string, Map<string, ScheduleGroup>>();

  for (const trainRows of groupByTrain(rows).values()) {
    const stops = stopsOf(trainRows, context);
    if (stops.length < 2) continue;

    const direction = majorityDirection(stops, context);
    if (!direction) continue;
    const headsign = stops[stops.length - 1].station.stationName;

    for (const stop of stops.slice(0, -1)) {
      const departure = stop.departureSec ?? stop.arrivalSec;
      if (departure === null) continue;

      const express: 0 | 1 = stop.isExpress ? 1 : 0;
      const byGroup = collected.get(stop.station.id) ?? new Map<string, ScheduleGroup>();
      collected.set(stop.station.id, byGroup);

      const groupKey = `${direction}|${headsign}|${express}`;
      const group = byGroup.get(groupKey) ?? [direction, headsign, express, []];
      byGroup.set(groupKey, group);
      group[3].push(toServiceSeconds(departure));
    }
  }

  const result = new Map<string, ScheduleGroup[]>();
  for (const [stationId, byGroup] of collected) {
    const groups = [...byGroup.values()].map((group): ScheduleGroup => {
      const times = [...new Set(group[3])].sort((a, b) => a - b);
      return [group[0], group[1], group[2], times];
    });
    groups.sort((a, b) =>
      `${a[0]}|${a[1]}|${a[2]}`.localeCompare(`${b[0]}|${b[1]}|${b[2]}`),
    );
    result.set(stationId, groups);
  }
  return result;
}
