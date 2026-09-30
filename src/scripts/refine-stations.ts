import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  LINE_META,
  OUT_DIR,
  RAW_DIR,
  normalize,
  readJson,
} from './lib/subway-common';

// renamed stations: `${LINE_NUM}|${station name in the station list}` -> name in the coordinate master
const NAME_ALIASES: Record<string, string> = {
  '01호선|평택지제': '지제',
  '07호선|자양': '뚝섬유원지',
  '경의선|한국항공대': '화전',
  '서해선|시우': '원곡',
  '용인경전철|용인중앙시장': '운동장.송담대',
  '인천2호선|서해구청': '서구청',
};

interface RawStation {
  STATION_CD: string;
  STATION_NM: string;
  LINE_NUM: string;
  FR_CODE: string;
}

interface RawMaster {
  BLDN_NM: string;
  ROUTE: string;
  LAT: string;
  LOT: string;
}

interface CoordinateOverride {
  lat: number;
  lng: number;
  source: string;
}

interface StationOut {
  id: string;
  lineId: string;
  stationCode: string;
  lineSeq?: number;
  stationName: string;
  lat: number | null;
  lng: number | null;
}

const SAME_STATION_KM = 1.5;

function distanceKm(a: RawMaster, b: RawMaster): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(Number(b.LAT) - Number(a.LAT));
  const dLng = toRad(Number(b.LOT) - Number(a.LOT));
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(Number(a.LAT))) *
      Math.cos(toRad(Number(b.LAT))) *
      Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function pickCandidate(
  candidates: RawMaster[],
  allowedRoutes: string[],
): RawMaster | undefined {
  const sameLine = candidates.filter((c) => allowedRoutes.includes(c.ROUTE));
  if (sameLine.length > 0) return sameLine[0];
  if (candidates.length === 0) return undefined;
  const isSameStation = candidates.every(
    (c) => distanceKm(candidates[0], c) <= SAME_STATION_KM,
  );
  return isSameStation ? candidates[0] : undefined;
}

function main(): void {
  const stations = readJson<RawStation[]>(
    join(RAW_DIR, 'seoul-stations-by-line.json'),
  );
  const master = readJson<RawMaster[]>(
    join(RAW_DIR, 'seoul-station-master.json'),
  );
  const overridePath = join(OUT_DIR, 'coordinate-overrides.json');
  const overrides = existsSync(overridePath)
    ? readJson<Record<string, CoordinateOverride>>(overridePath)
    : {};

  const masterByName = new Map<string, RawMaster[]>();
  for (const row of master) {
    const key = normalize(row.BLDN_NM);
    masterByName.set(key, [...(masterByName.get(key) ?? []), row]);
  }

  // lineSeq comes from build-topology.ts (KRIC order); run refine:stations again after it
  const topologyPath = join(OUT_DIR, 'line-topology.json');
  const lineSeq: Record<string, number> = existsSync(topologyPath)
    ? readJson<{ lineSeq: Record<string, number> }>(topologyPath).lineSeq
    : {};

  const unresolved: string[] = [];
  const result: StationOut[] = [];

  for (const raw of stations) {
    const meta = LINE_META[raw.LINE_NUM];
    if (!meta) throw new Error(`unknown line in station list: ${raw.LINE_NUM}`);
    const id = `${meta.id}_${raw.FR_CODE}`;
    const masterName =
      NAME_ALIASES[`${raw.LINE_NUM}|${raw.STATION_NM}`] ?? raw.STATION_NM;
    const candidates = masterByName.get(normalize(masterName)) ?? [];
    const picked = pickCandidate(candidates, meta.masterRoutes);
    const override = overrides[id];

    let lat: number | null = null;
    let lng: number | null = null;
    if (override) {
      lat = override.lat;
      lng = override.lng;
    } else if (picked) {
      lat = Number(picked.LAT);
      lng = Number(picked.LOT);
    } else {
      unresolved.push(`${id} ${raw.STATION_NM} (${raw.LINE_NUM})`);
    }

    result.push({
      id,
      lineId: meta.id,
      stationCode: raw.FR_CODE,
      lineSeq: lineSeq[id],
      stationName: raw.STATION_NM,
      lat,
      lng,
    });
  }

  const ids = new Set(result.map((s) => s.id));
  if (ids.size !== result.length) throw new Error('duplicate station id');

  const lines = Object.values(LINE_META)
    .map(({ id, lineName, colorHex }) => ({ id, lineName, colorHex }))
    .sort((a, b) => a.id.localeCompare(b.id));

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, 'lines.json'),
    JSON.stringify(lines, null, 2) + '\n',
  );
  writeFileSync(
    join(OUT_DIR, 'stations.json'),
    JSON.stringify(result, null, 2) + '\n',
  );

  console.log(`lines: ${lines.length}, stations: ${result.length}`);
  console.log(`without coordinates: ${unresolved.length}`);
  for (const line of unresolved) console.log(`  ${line}`);
}

main();
