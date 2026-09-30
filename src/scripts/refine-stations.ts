import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const RAW_DIR = join(__dirname, '../../data-raw');
const OUT_DIR = join(__dirname, '../data/subway');

interface LineMeta {
  id: string;
  lineName: string;
  colorHex: string;
  masterRoutes: string[];
}

// dataset LINE_NUM -> line id, display name, color (Wikipedia Module:Adjacent stations line colors), routes used in the coordinate master
const LINE_META: Record<string, LineMeta> = {
  '01호선': { id: '01', lineName: '1호선', colorHex: '#0052A4', masterRoutes: ['1호선', '경부선', '경원선', '경인선', '장항선'] },
  '02호선': { id: '02', lineName: '2호선', colorHex: '#00A84D', masterRoutes: ['2호선'] },
  '03호선': { id: '03', lineName: '3호선', colorHex: '#EF7C1C', masterRoutes: ['3호선'] },
  '04호선': { id: '04', lineName: '4호선', colorHex: '#00A4E3', masterRoutes: ['4호선', '안산선', '과천선', '진접선'] },
  '05호선': { id: '05', lineName: '5호선', colorHex: '#996CAC', masterRoutes: ['5호선'] },
  '06호선': { id: '06', lineName: '6호선', colorHex: '#CD7C2F', masterRoutes: ['6호선'] },
  '07호선': { id: '07', lineName: '7호선', colorHex: '#747F00', masterRoutes: ['7호선', '7호선(인천)'] },
  '08호선': { id: '08', lineName: '8호선', colorHex: '#E6186C', masterRoutes: ['8호선', '별내선'] },
  '09호선': { id: '09', lineName: '9호선', colorHex: '#BDB092', masterRoutes: ['9호선', '9호선(연장)'] },
  'GTX-A': { id: 'GA', lineName: 'GTX-A', colorHex: '#9A6292', masterRoutes: ['수도권 광역급행철도'] },
  경강선: { id: 'GG', lineName: '경강선', colorHex: '#0054A6', masterRoutes: ['경강선'] },
  경의선: { id: 'GJ', lineName: '경의중앙선', colorHex: '#77C4A3', masterRoutes: ['경의중앙선', '중앙선'] },
  경춘선: { id: 'GC', lineName: '경춘선', colorHex: '#178C72', masterRoutes: ['경춘선'] },
  공항철도: { id: 'AR', lineName: '공항철도', colorHex: '#0090D2', masterRoutes: ['공항철도1호선'] },
  김포도시철도: { id: 'GM', lineName: '김포골드라인', colorHex: '#A17800', masterRoutes: ['김포골드라인'] },
  서해선: { id: 'SH', lineName: '서해선', colorHex: '#8FC31F', masterRoutes: ['서해선'] },
  수인분당선: { id: 'SD', lineName: '수인분당선', colorHex: '#FABE00', masterRoutes: ['분당선', '수인선'] },
  신림선: { id: 'SL', lineName: '신림선', colorHex: '#6789CA', masterRoutes: ['신림선'] },
  신분당선: { id: 'SB', lineName: '신분당선', colorHex: '#D31145', masterRoutes: ['신분당선', '신분당선(연장)', '신분당선(연장2)'] },
  용인경전철: { id: 'EV', lineName: '에버라인', colorHex: '#56AD2D', masterRoutes: ['에버라인선'] },
  우이신설경전철: { id: 'UI', lineName: '우이신설선', colorHex: '#B7C450', masterRoutes: ['우이신설선'] },
  의정부경전철: { id: 'UJ', lineName: '의정부경전철', colorHex: '#FD8100', masterRoutes: ['의정부선'] },
  인천2호선: { id: 'I2', lineName: '인천2호선', colorHex: '#F06A00', masterRoutes: ['인천2호선'] },
  인천선: { id: 'I1', lineName: '인천1호선', colorHex: '#8CADCB', masterRoutes: ['인천1호선'] },
};

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
  stationName: string;
  lat: number | null;
  lng: number | null;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function normalize(name: string): string {
  return name.replace(/\(.*?\)/g, '').replace(/[·.]/g, '').trim();
}

const SAME_STATION_KM = 1.5;

function distanceKm(a: RawMaster, b: RawMaster): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(Number(b.LAT) - Number(a.LAT));
  const dLng = toRad(Number(b.LOT) - Number(a.LOT));
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(Number(a.LAT))) * Math.cos(toRad(Number(b.LAT))) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function pickCandidate(candidates: RawMaster[], allowedRoutes: string[]): RawMaster | undefined {
  const sameLine = candidates.filter((c) => allowedRoutes.includes(c.ROUTE));
  if (sameLine.length > 0) return sameLine[0];
  if (candidates.length === 0) return undefined;
  const isSameStation = candidates.every((c) => distanceKm(candidates[0], c) <= SAME_STATION_KM);
  return isSameStation ? candidates[0] : undefined;
}

function main(): void {
  const stations = readJson<RawStation[]>(join(RAW_DIR, 'seoul-stations-by-line.json'));
  const master = readJson<RawMaster[]>(join(RAW_DIR, 'seoul-station-master.json'));
  const overridePath = join(OUT_DIR, 'coordinate-overrides.json');
  const overrides = existsSync(overridePath) ? readJson<Record<string, CoordinateOverride>>(overridePath) : {};

  const masterByName = new Map<string, RawMaster[]>();
  for (const row of master) {
    const key = normalize(row.BLDN_NM);
    masterByName.set(key, [...(masterByName.get(key) ?? []), row]);
  }

  const unresolved: string[] = [];
  const result: StationOut[] = [];

  for (const raw of stations) {
    const meta = LINE_META[raw.LINE_NUM];
    if (!meta) throw new Error(`unknown line in station list: ${raw.LINE_NUM}`);
    const id = `${meta.id}_${raw.FR_CODE}`;
    const masterName = NAME_ALIASES[`${raw.LINE_NUM}|${raw.STATION_NM}`] ?? raw.STATION_NM;
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

    result.push({ id, lineId: meta.id, stationCode: raw.FR_CODE, stationName: raw.STATION_NM, lat, lng });
  }

  const ids = new Set(result.map((s) => s.id));
  if (ids.size !== result.length) throw new Error('duplicate station id');

  const lines = Object.values(LINE_META)
    .map(({ id, lineName, colorHex }) => ({ id, lineName, colorHex }))
    .sort((a, b) => a.id.localeCompare(b.id));

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'lines.json'), JSON.stringify(lines, null, 2) + '\n');
  writeFileSync(join(OUT_DIR, 'stations.json'), JSON.stringify(result, null, 2) + '\n');

  console.log(`lines: ${lines.length}, stations: ${result.length}`);
  console.log(`without coordinates: ${unresolved.length}`);
  for (const line of unresolved) console.log(`  ${line}`);
}

main();
