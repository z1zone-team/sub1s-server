import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  ScheduleGroup,
  ServiceDayType,
  TrainScheduleFile,
} from '../domain/arrival/models/train-schedule';
import { TrainDirection } from '../domain/arrival/ports/INextTrainProvider';
import { buildKricStationMap } from './lib/kric-convenience';
import { KricTimetableRow } from './lib/kric-timetable';
import {
  ResolvedStation,
  buildStationSchedules,
  kricStationKey,
} from './lib/next-train-schedule';
import { SeoulTimetableRow, buildSeoulGroups } from './lib/seoul-timetable';
import { OUT_DIR, RAW_DIR, loadStations, readJson } from './lib/subway-common';

const SOURCES: Record<ServiceDayType, string> = {
  weekday: 'kric-timetables',
  holiday: 'kric-timetables-9',
};

// KRIC가 주지 않는 시간표는 서울 열린데이터광장 역별 열차 시간표(fetch:seoul-timetables)로 채운다. 이미 있는 역은 덮어쓰지 않는다
const SEOUL_SOURCES: Array<{ dayType: ServiceDayType; dir: string }> = [
  { dayType: 'weekday', dir: 'seoul-timetables-1' },
  { dayType: 'holiday', dir: 'seoul-timetables-3' },
];

// INOUT_TAG(1 상행/내선, 2 하행/외선)를 노선의 방향으로. 서울 API가 주는 열차 행선지와 KRIC 시간표의 방향을 맞춰 확인했다
const SEOUL_DIRECTIONS: Record<string, Record<string, TrainDirection>> = {
  '02': { '1': 'INNER', '2': 'OUTER' },
  '07': { '1': 'UP', '2': 'DOWN' },
};

interface EdgeRow {
  fromStationId: string;
  toStationId: string;
  direction: TrainDirection;
}

function loadRows(dirName: string): KricTimetableRow[] | undefined {
  const dir = join(RAW_DIR, dirName);
  if (!existsSync(dir)) return undefined;

  const rows: KricTimetableRow[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as {
        body?: KricTimetableRow[];
      };
      if (Array.isArray(parsed.body)) rows.push(...parsed.body);
    } catch {
      console.warn(`[Schedule] Skipped unreadable file ${dirName}/${file}`);
    }
  }
  return rows;
}

function mergeSeoulSchedules(
  dayType: ServiceDayType,
  dirName: string,
  target: Record<string, ScheduleGroup[]>,
  stationIds: Set<string>,
): void {
  const dir = join(RAW_DIR, dirName);
  if (!existsSync(dir)) return;

  const rowsByStation = new Map<string, SeoulTimetableRow[]>();
  const inoutTags = new Map<string, Set<string>>();
  for (const file of readdirSync(dir)) {
    const match = /^(.+)_([12])\.json$/.exec(file);
    if (!match || !stationIds.has(match[1])) continue;
    const [, stationId, inoutTag] = match;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as {
        SearchSTNTimeTableByIDService?: { row?: SeoulTimetableRow[] };
      };
      // 응답의 역 외부 코드가 우리 역 ID와 같은 역만 쓴다
      const rows = (parsed.SearchSTNTimeTableByIDService?.row ?? []).filter(
        (row) => row.FR_CODE === stationId.split('_')[1],
      );
      if (rows.length === 0) continue;
      rowsByStation.set(stationId, [...(rowsByStation.get(stationId) ?? []), ...rows]);
      inoutTags.set(stationId, (inoutTags.get(stationId) ?? new Set()).add(inoutTag));
    } catch {
      console.warn(`[Schedule] Skipped unreadable file ${dirName}/${file}`);
    }
  }

  let added = 0;
  for (const stationId of [...rowsByStation.keys()].sort()) {
    if (target[stationId]) continue;
    const directions = SEOUL_DIRECTIONS[stationId.split('_')[0]] ?? {};
    const groups = buildSeoulGroups(rowsByStation.get(stationId) ?? [], (tag) => directions[tag]);
    if (groups.length === 0) continue;
    target[stationId] = groups;
    added += 1;
  }
  console.log(`[Schedule] ${dayType}: added ${added} stations from ${dirName}`);
}

// 한 역을 한 줄로 써서 갱신할 때 diff가 역 단위로 보이게 한다
function serialize(file: TrainScheduleFile): string {
  const dayTypes = (Object.keys(file.dayTypes) as ServiceDayType[]).map((dayType) => {
    const stations = Object.entries(file.dayTypes[dayType]).map(
      ([stationId, groups]) => `    ${JSON.stringify(stationId)}:${JSON.stringify(groups)}`,
    );
    return `  ${JSON.stringify(dayType)}:{\n${stations.join(',\n')}\n  }`;
  });
  return `{"dayTypes":{\n${dayTypes.join(',\n')}\n}}\n`;
}

function main(): void {
  const stations = loadStations();
  const kricMap = buildKricStationMap(stations, RAW_DIR);
  const byKricKey = new Map<string, ResolvedStation>();
  for (const station of stations) {
    const info = kricMap.get(station.id);
    if (!info) continue;
    byKricKey.set(
      kricStationKey({
        railOprIsttCd: info.railOprIsttCd,
        lnCd: info.lnCd,
        stinCd: info.stinCd,
      }),
      { id: station.id, stationName: station.stationName },
    );
  }

  const directions = new Map<string, TrainDirection>();
  for (const edge of readJson<EdgeRow[]>(join(OUT_DIR, 'edges.json'))) {
    directions.set(`${edge.fromStationId}>${edge.toStationId}`, edge.direction);
  }

  // --merge-only: KRIC 원본이 이 PC에 없을 때 이미 만들어진 시간표에 서울 시간표만 합친다
  const mergeOnly = process.argv.includes('--merge-only');
  const dayTypes: Record<ServiceDayType, Record<string, ScheduleGroup[]>> = mergeOnly
    ? readJson<TrainScheduleFile>(join(OUT_DIR, 'next-train-schedule.json')).dayTypes
    : { weekday: {}, holiday: {} };

  for (const dayType of mergeOnly ? [] : (Object.keys(SOURCES) as ServiceDayType[])) {
    const rows = loadRows(SOURCES[dayType]);
    if (!rows) {
      console.log(`[Schedule] ${dayType}: no raw data (${SOURCES[dayType]}), left empty`);
      continue;
    }
    const schedules = buildStationSchedules(rows, {
      resolveStation: (key) => byKricKey.get(key),
      edgeDirection: (from, to) => directions.get(`${from}>${to}`),
    });
    for (const stationId of [...schedules.keys()].sort()) {
      dayTypes[dayType][stationId] = schedules.get(stationId) ?? [];
    }
    const departures = Object.values(dayTypes[dayType])
      .flat()
      .reduce((sum, group) => sum + group[3].length, 0);
    console.log(
      `[Schedule] ${dayType}: ${rows.length} rows -> ${Object.keys(dayTypes[dayType]).length} stations, ${departures} departures`,
    );
  }

  const stationIds = new Set(stations.map((station) => station.id));
  for (const { dayType, dir } of SEOUL_SOURCES) {
    mergeSeoulSchedules(dayType, dir, dayTypes[dayType], stationIds);
  }
  // 역 ID 순서를 유지해 갱신할 때 diff가 역 단위로 보이게 한다
  for (const dayType of Object.keys(dayTypes) as ServiceDayType[]) {
    dayTypes[dayType] = Object.fromEntries(
      Object.entries(dayTypes[dayType]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }

  const outPath = join(OUT_DIR, 'next-train-schedule.json');
  writeFileSync(outPath, serialize({ dayTypes }), 'utf-8');
  console.log(`[Schedule] Saved ${outPath}`);
}

main();
