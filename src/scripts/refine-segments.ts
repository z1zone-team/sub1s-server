import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  LINE_META,
  OUT_DIR,
  RAW_DIR,
  StationRecord,
  distanceKm,
  loadStations,
  normalize,
  readJson,
  resolveDatasetName,
  toSeconds,
} from './lib/subway-common';

interface RawDistanceRow {
  SBWY_ROUT_LN: string;
  SBWY_STNS_NM: string;
  HM: string;
  DIST_KM: number;
  ACML_DIST: number;
}

interface Segment {
  lineId: string;
  fromStationId: string;
  toStationId: string;
  distanceKm: number;
  durationSec: number;
}

// straight-line distance can never exceed track distance, so pairs far apart on the map are not neighbors
const GEO_TOLERANCE_RATIO = 1.15;
const GEO_TOLERANCE_KM = 0.2;
const MAX_TRACK_TO_GEO = 3;
const MAX_TRACK_EXTRA_KM = 0.5;

// branch start stations: the first row of a branch stores the distance from its junction, which is not the previous row
const JUNCTIONS: Array<{
  line: string;
  junction: string;
  branchFirst: string;
}> = [
  { line: '2', junction: '성수', branchFirst: '용답' },
  { line: '2', junction: '신도림', branchFirst: '도림천' },
  { line: '5', junction: '강동', branchFirst: '둔촌동' },
];

function isPlausibleNeighbor(track: number, geo: number): boolean {
  return (
    geo <= track * GEO_TOLERANCE_RATIO + GEO_TOLERANCE_KM &&
    track <= geo * MAX_TRACK_TO_GEO + MAX_TRACK_EXTRA_KM
  );
}

function main(): void {
  const rows = readJson<RawDistanceRow[]>(
    join(RAW_DIR, 'seoul-station-distance-time.json'),
  );
  const stations = loadStations();
  const byKey = new Map<string, StationRecord>(
    stations.map((s) => [`${s.lineId}|${normalize(s.stationName)}`, s]),
  );

  const segments: Segment[] = [];
  const unresolved: string[] = [];
  const rejected: string[] = [];

  for (const line of new Set(rows.map((r) => r.SBWY_ROUT_LN))) {
    const meta = LINE_META[`0${line}호선`];
    if (!meta) throw new Error(`unknown line number: ${line}`);
    const lineRows = rows.filter((r) => r.SBWY_ROUT_LN === line);
    const junctions = JUNCTIONS.filter((j) => j.line === line);

    for (let i = 1; i < lineRows.length; i += 1) {
      const row = lineRows[i];
      const junction = junctions.find(
        (j) => j.branchFirst === row.SBWY_STNS_NM,
      );
      const fromName = junction
        ? junction.junction
        : lineRows[i - 1].SBWY_STNS_NM;
      const from = byKey.get(
        `${meta.id}|${resolveDatasetName(line, fromName)}`,
      );
      const to = byKey.get(
        `${meta.id}|${resolveDatasetName(line, row.SBWY_STNS_NM)}`,
      );
      if (!from || !to) {
        unresolved.push(
          `${meta.lineName} ${fromName}->${row.SBWY_STNS_NM} (no station: ${from ? row.SBWY_STNS_NM : fromName})`,
        );
        continue;
      }
      const geo = distanceKm(from.lat, from.lng, to.lat, to.lng);
      if (!isPlausibleNeighbor(row.DIST_KM, geo)) {
        rejected.push(
          `${meta.lineName} ${from.stationName}->${to.stationName} track=${row.DIST_KM}km geo=${geo.toFixed(2)}km`,
        );
        continue;
      }
      segments.push({
        lineId: meta.id,
        fromStationId: from.id,
        toStationId: to.id,
        distanceKm: row.DIST_KM,
        durationSec: toSeconds(row.HM),
      });
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, 'segments.json'),
    JSON.stringify(segments, null, 2) + '\n',
  );

  console.log(
    `segments: ${segments.length}, unresolved: ${unresolved.length}, rejected (not adjacent): ${rejected.length}`,
  );
  for (const message of unresolved) console.log(`  unresolved ${message}`);
  for (const message of rejected) console.log(`  rejected ${message}`);

  const perLine = new Map<string, { km: number; sec: number }>();
  for (const s of segments) {
    const acc = perLine.get(s.lineId) ?? { km: 0, sec: 0 };
    perLine.set(s.lineId, {
      km: acc.km + s.distanceKm,
      sec: acc.sec + s.durationSec,
    });
  }
  let totalKm = 0;
  let totalSec = 0;
  for (const [lineId, acc] of [...perLine].sort()) {
    totalKm += acc.km;
    totalSec += acc.sec;
    console.log(
      `  line ${lineId}: ${acc.km.toFixed(1)}km ${(acc.km / (acc.sec / 3600)).toFixed(1)}km/h`,
    );
  }
  console.log(
    `  all: ${totalKm.toFixed(1)}km ${(totalKm / (totalSec / 3600)).toFixed(1)}km/h`,
  );
}

main();
