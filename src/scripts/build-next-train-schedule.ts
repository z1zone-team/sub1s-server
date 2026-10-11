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
import { OUT_DIR, RAW_DIR, loadStations, readJson } from './lib/subway-common';

const SOURCES: Record<ServiceDayType, string> = {
  weekday: 'kric-timetables',
  holiday: 'kric-timetables-9',
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

  const dayTypes: Record<ServiceDayType, Record<string, ScheduleGroup[]>> = {
    weekday: {},
    holiday: {},
  };

  for (const dayType of Object.keys(SOURCES) as ServiceDayType[]) {
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

  const outPath = join(OUT_DIR, 'next-train-schedule.json');
  writeFileSync(outPath, serialize({ dayTypes }), 'utf-8');
  console.log(`[Schedule] Saved ${outPath}`);
}

main();
