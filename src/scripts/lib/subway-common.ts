import { readFileSync } from 'fs';
import { join } from 'path';

export const RAW_DIR = join(__dirname, '../../../data-raw');
export const OUT_DIR = join(__dirname, '../../data/subway');

export interface LineMeta {
  id: string;
  lineName: string;
  colorHex: string;
  masterRoutes: string[];
}

// dataset LINE_NUM -> line id, display name, color (Wikipedia Module:Adjacent stations line colors), routes used in the coordinate master
export const LINE_META: Record<string, LineMeta> = {
  '01호선': {
    id: '01',
    lineName: '1호선',
    colorHex: '#0052A4',
    masterRoutes: ['1호선', '경부선', '경원선', '경인선', '장항선'],
  },
  '02호선': {
    id: '02',
    lineName: '2호선',
    colorHex: '#00A84D',
    masterRoutes: ['2호선'],
  },
  '03호선': {
    id: '03',
    lineName: '3호선',
    colorHex: '#EF7C1C',
    masterRoutes: ['3호선'],
  },
  '04호선': {
    id: '04',
    lineName: '4호선',
    colorHex: '#00A4E3',
    masterRoutes: ['4호선', '안산선', '과천선', '진접선'],
  },
  '05호선': {
    id: '05',
    lineName: '5호선',
    colorHex: '#996CAC',
    masterRoutes: ['5호선'],
  },
  '06호선': {
    id: '06',
    lineName: '6호선',
    colorHex: '#CD7C2F',
    masterRoutes: ['6호선'],
  },
  '07호선': {
    id: '07',
    lineName: '7호선',
    colorHex: '#747F00',
    masterRoutes: ['7호선', '7호선(인천)'],
  },
  '08호선': {
    id: '08',
    lineName: '8호선',
    colorHex: '#E6186C',
    masterRoutes: ['8호선', '별내선'],
  },
  '09호선': {
    id: '09',
    lineName: '9호선',
    colorHex: '#BDB092',
    masterRoutes: ['9호선', '9호선(연장)'],
  },
  'GTX-A': {
    id: 'GA',
    lineName: 'GTX-A',
    colorHex: '#9A6292',
    masterRoutes: ['수도권 광역급행철도'],
  },
  경강선: {
    id: 'GG',
    lineName: '경강선',
    colorHex: '#0054A6',
    masterRoutes: ['경강선'],
  },
  경의선: {
    id: 'GJ',
    lineName: '경의중앙선',
    colorHex: '#77C4A3',
    masterRoutes: ['경의중앙선', '중앙선'],
  },
  경춘선: {
    id: 'GC',
    lineName: '경춘선',
    colorHex: '#178C72',
    masterRoutes: ['경춘선'],
  },
  공항철도: {
    id: 'AR',
    lineName: '공항철도',
    colorHex: '#0090D2',
    masterRoutes: ['공항철도1호선'],
  },
  김포도시철도: {
    id: 'GM',
    lineName: '김포골드라인',
    colorHex: '#A17800',
    masterRoutes: ['김포골드라인'],
  },
  서해선: {
    id: 'SH',
    lineName: '서해선',
    colorHex: '#8FC31F',
    masterRoutes: ['서해선'],
  },
  수인분당선: {
    id: 'SD',
    lineName: '수인분당선',
    colorHex: '#FABE00',
    masterRoutes: ['분당선', '수인선'],
  },
  신림선: {
    id: 'SL',
    lineName: '신림선',
    colorHex: '#6789CA',
    masterRoutes: ['신림선'],
  },
  신분당선: {
    id: 'SB',
    lineName: '신분당선',
    colorHex: '#D31145',
    masterRoutes: ['신분당선', '신분당선(연장)', '신분당선(연장2)'],
  },
  용인경전철: {
    id: 'EV',
    lineName: '에버라인',
    colorHex: '#56AD2D',
    masterRoutes: ['에버라인선'],
  },
  우이신설경전철: {
    id: 'UI',
    lineName: '우이신설선',
    colorHex: '#B7C450',
    masterRoutes: ['우이신설선'],
  },
  의정부경전철: {
    id: 'UJ',
    lineName: '의정부경전철',
    colorHex: '#FD8100',
    masterRoutes: ['의정부선'],
  },
  인천2호선: {
    id: 'I2',
    lineName: '인천2호선',
    colorHex: '#F06A00',
    masterRoutes: ['인천2호선'],
  },
  인천선: {
    id: 'I1',
    lineName: '인천1호선',
    colorHex: '#8CADCB',
    masterRoutes: ['인천1호선'],
  },
};

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

export function normalize(name: string): string {
  return name
    .replace(/\(.*?\)/g, '')
    .replace(/[·.]/g, '')
    .trim();
}

export interface StationRecord {
  id: string;
  lineId: string;
  stationCode: string;
  stationName: string;
  lat: number;
  lng: number;
}

export function loadStations(): StationRecord[] {
  return readJson<StationRecord[]>(join(OUT_DIR, 'stations.json'));
}

export function distanceKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function toSeconds(mmss: string): number {
  const [m, s] = mmss.split(':').map(Number);
  return m * 60 + s;
}

// station names used by the Seoul Metro distance/transfer datasets that were renamed in the current station list
export const DATASET_NAME_ALIASES: Record<string, string> = {
  '4|당고개': '불암산',
  '6|신내역': '신내',
  '7|뚝섬유원지': '자양',
};

export function resolveDatasetName(lineNumber: string, name: string): string {
  return normalize(DATASET_NAME_ALIASES[`${lineNumber}|${name}`] ?? name);
}

// one physical station that appears under different names depending on the line (DATA_PIPELINE.md 2.1)
export const EQUIVALENT_NAMES: string[][] = [['총신대입구', '이수']];

export function equivalentNames(name: string): string[] {
  const group = EQUIVALENT_NAMES.find((names) => names.includes(name));
  return group ?? [name];
}

// KRIC line code (lnCd) -> line id of the station list
export const KRIC_LINE_TO_LINE_ID: Record<string, string> = {
  '1': '01',
  '2': '02',
  '3': '03',
  '4': '04',
  '5': '05',
  '6': '06',
  '7': '07',
  '8': '08',
  '9': '09',
  A: 'GA',
  A1: 'AR',
  D1: 'SB',
  E1: 'EV',
  G1: 'GM',
  I1: 'I1',
  I2: 'I2',
  K1: 'SD',
  K2: 'GC',
  K4: 'GJ',
  K5: 'GG',
  L1: 'SL',
  U1: 'UJ',
  UI: 'UI',
  WS: 'SH',
};

// KRIC uses the administrative name 능길 for 신길온천, whose rename was suspended in 2021, so the signage name is kept.
export const KRIC_NAME_ALIASES: Record<string, string> = {
  능길: '신길온천',
};

// stations in the KRIC lists that are intentionally left out of the graph
export const EXCLUDED_KRIC_STATIONS = ['도라산'];

// KRIC names may end with 역 (e.g. 하남검단산역)
export function kricKey(name: string): string {
  const base = normalize(name);
  const stripped =
    base.endsWith('역') && base.length > 2 ? base.slice(0, -1) : base;
  return KRIC_NAME_ALIASES[stripped] ?? stripped;
}
