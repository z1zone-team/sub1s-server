import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  LINE_META,
  OUT_DIR,
  RAW_DIR,
  StationRecord,
  equivalentNames,
  loadStations,
  normalize,
  readJson,
  resolveDatasetName,
  toSeconds,
} from './lib/subway-common';

interface RawTransferRow {
  NO: string;
  LINE: string;
  TRFSTN_NM: string;
  TRAS_RTE: string;
  TRAS_DSTNC: string;
  TRAS_REQ_HR: string;
}

interface TransferOut {
  fromStationId: string;
  toStationId: string;
  walkingDurationSec: number;
}

// transfer destination route names in the dataset -> candidate line keys in the station list
// '국철' is a generic Korail route (e.g. 수도권 1호선, 수인분당선), so the line is chosen by which candidate has the station
const ROUTE_TO_LINES: Record<string, string[]> = {
  '1호선': ['01호선'],
  '2호선': ['02호선'],
  '3호선': ['03호선'],
  '4호선': ['04호선'],
  '5호선': ['05호선'],
  '6호선': ['06호선'],
  '7호선': ['07호선'],
  '8호선': ['08호선'],
  '9호선': ['09호선'],
  경원선: ['01호선'],
  국철: ['01호선', '수인분당선', '경의선', '경춘선'],
  경의중앙선: ['경의선'],
  경춘선: ['경춘선'],
  공항철도: ['공항철도'],
  김포골드라인: ['김포도시철도'],
  서해선: ['서해선'],
  수인분당선: ['수인분당선'],
  신림선: ['신림선'],
  신분당선: ['신분당선'],
  우이신설선: ['우이신설경전철'],
};

function main(): void {
  const rows = readJson<RawTransferRow[]>(join(RAW_DIR, 'seoul-transfer.json'));
  const stations = loadStations();
  const byKey = new Map<string, StationRecord>(
    stations.map((s) => [`${s.lineId}|${normalize(s.stationName)}`, s]),
  );

  const directed = new Map<string, TransferOut>();
  const unresolved: string[] = [];
  const conflicts: string[] = [];

  for (const row of rows) {
    const fromMeta = LINE_META[`0${row.LINE}호선`];
    const toKeys = ROUTE_TO_LINES[row.TRAS_RTE];
    if (!fromMeta || !toKeys) {
      unresolved.push(
        `${row.LINE}호선 ${row.TRFSTN_NM} -> ${row.TRAS_RTE} (unknown line)`,
      );
      continue;
    }
    const names = equivalentNames(resolveDatasetName(row.LINE, row.TRFSTN_NM));
    const from = names
      .map((n) => byKey.get(`${fromMeta.id}|${n}`))
      .find((s): s is StationRecord => s !== undefined);
    const toStations = toKeys
      .flatMap((key) =>
        LINE_META[key]
          ? names.map((n) => byKey.get(`${LINE_META[key].id}|${n}`))
          : [],
      )
      .filter((s): s is StationRecord => s !== undefined);
    if (!from || toStations.length !== 1) {
      const reason = !from
        ? 'from station not found'
        : toStations.length === 0
          ? 'to station not found'
          : 'ambiguous to station';
      unresolved.push(
        `${row.LINE}호선 ${row.TRFSTN_NM} -> ${row.TRAS_RTE} (${reason})`,
      );
      continue;
    }
    const to = toStations[0];
    const entry: TransferOut = {
      fromStationId: from.id,
      toStationId: to.id,
      walkingDurationSec: toSeconds(row.TRAS_REQ_HR),
    };
    const key = `${entry.fromStationId}>${entry.toStationId}`;
    const existing = directed.get(key);
    if (existing && existing.walkingDurationSec !== entry.walkingDurationSec) {
      conflicts.push(
        `${key} ${existing.walkingDurationSec}s vs ${entry.walkingDurationSec}s`,
      );
    }
    if (!existing) directed.set(key, entry);
  }

  const original = directed.size;
  for (const entry of [...directed.values()]) {
    const reverseKey = `${entry.toStationId}>${entry.fromStationId}`;
    if (!directed.has(reverseKey)) {
      directed.set(reverseKey, {
        fromStationId: entry.toStationId,
        toStationId: entry.fromStationId,
        walkingDurationSec: entry.walkingDurationSec,
      });
    }
  }

  const transfers = [...directed.values()].sort((a, b) =>
    `${a.fromStationId}>${a.toStationId}`.localeCompare(
      `${b.fromStationId}>${b.toStationId}`,
    ),
  );
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, 'transfers.json'),
    JSON.stringify(transfers, null, 2) + '\n',
  );

  console.log(
    `rows: ${rows.length}, directed from data: ${original}, mirrored: ${transfers.length - original}, total: ${transfers.length}`,
  );
  console.log(
    `unresolved: ${unresolved.length}, conflicts: ${conflicts.length}`,
  );
  for (const message of unresolved) console.log(`  unresolved ${message}`);
  for (const message of conflicts) console.log(`  conflict ${message}`);
}

main();
