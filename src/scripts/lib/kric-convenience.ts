import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  KRIC_LINE_TO_LINE_ID,
  RAW_DIR,
  StationRecord,
  kricKey,
} from './subway-common';

export interface KricCarNumberRow {
  railOprIsttCd: string;
  lnCd: string;
  stinCd: string;
  plfNo: number;
  trnClsfCd?: string;
  trnClsfNm?: string;
  carOrdr: number;
  carEtrcNo: number;
}

export interface KricPlatformRow {
  railOprIsttCd: string;
  lnCd: string;
  stinCd: string;
  plfNo: number;
  updnDvCd?: string;
  runDirTmnStinCd?: string | null;
  grndDvCd?: string;
  stinFlor?: number;
  plfTpCd?: string;
  plfTpNm?: string;
  plfCplFlg?: string;
  scrCharExt?: string;
  sfFotExt?: string;
}

export interface KricGateRow {
  railOprIsttCd: string;
  lnCd: string;
  stinCd: string;
  exitNo: string;
  impFaclNm: string;
  dst?: string | null;
  adr?: string | null;
  telNo?: string | null;
}

export interface StationDoorsRecord {
  stationId: string;
  stationName: string;
  lineId: string;
  kric: {
    railOprIsttCd: string;
    lnCd: string;
    stinCd: string;
  };
  doors: string[];
  doorsByPlf: Record<number, string[]>;
}

export function formatDoor(carOrdr: number, carEtrcNo: number): string {
  return `${carOrdr}-${carEtrcNo}`;
}

// Numerically sorts door labels (e.g. '2-1' before '10-4') and removes duplicates
export function sortDoors(doors: string[]): string[] {
  const unique = Array.from(new Set(doors.filter((d) => Boolean(d))));
  return unique.sort((a, b) => {
    const [carA, doorA] = a.split('-').map(Number);
    const [carB, doorB] = b.split('-').map(Number);
    if (!Number.isNaN(carA) && !Number.isNaN(carB) && carA !== carB) {
      return carA - carB;
    }
    if (!Number.isNaN(doorA) && !Number.isNaN(doorB)) {
      return doorA - doorB;
    }
    return a.localeCompare(b);
  });
}

// Safely extracts body rows from KRIC OpenAPI response envelope
export function extractKricBody<T = Record<string, unknown>>(
  json: unknown,
): T[] {
  if (!json || typeof json !== 'object') return [];
  const obj = json as Record<string, unknown>;
  if (Array.isArray(obj.body)) {
    return obj.body as T[];
  }
  if (obj.body && typeof obj.body === 'object') {
    const bodyObj = obj.body as Record<string, unknown>;
    if (Array.isArray(bodyObj.items)) return bodyObj.items as T[];
    if (bodyObj.items && typeof bodyObj.items === 'object') {
      const itemsObj = bodyObj.items as Record<string, unknown>;
      if (Array.isArray(itemsObj.item)) return itemsObj.item as T[];
      if (itemsObj.item) return [itemsObj.item as T];
    }
  }
  return [];
}

export function parseCarNumberRows(json: unknown): KricCarNumberRow[] {
  const rawRows = extractKricBody<Record<string, unknown>>(json);
  const result: KricCarNumberRow[] = [];

  for (const r of rawRows) {
    const carOrdr = Number(r.carOrdr);
    const carEtrcNo = Number(r.carEtrcNo);
    const plfNo = Number(r.plfNo) || 1;
    if (
      Number.isFinite(carOrdr) &&
      carOrdr > 0 &&
      Number.isFinite(carEtrcNo) &&
      carEtrcNo > 0
    ) {
      result.push({
        railOprIsttCd: String(r.railOprIsttCd ?? ''),
        lnCd: String(r.lnCd ?? ''),
        stinCd: String(r.stinCd ?? ''),
        plfNo,
        trnClsfCd: r.trnClsfCd ? String(r.trnClsfCd) : undefined,
        trnClsfNm: r.trnClsfNm ? String(r.trnClsfNm) : undefined,
        carOrdr,
        carEtrcNo,
      });
    }
  }

  return result;
}

export function aggregateDoors(
  station: StationRecord,
  kricInfo: { railOprIsttCd: string; lnCd: string; stinCd: string },
  rows: KricCarNumberRow[],
): StationDoorsRecord {
  const allDoors: string[] = [];
  const doorsByPlf: Record<number, string[]> = {};

  for (const row of rows) {
    const door = formatDoor(row.carOrdr, row.carEtrcNo);
    allDoors.push(door);
    doorsByPlf[row.plfNo] = doorsByPlf[row.plfNo] || [];
    doorsByPlf[row.plfNo].push(door);
  }

  for (const plf of Object.keys(doorsByPlf)) {
    const p = Number(plf);
    doorsByPlf[p] = sortDoors(doorsByPlf[p]);
  }

  return {
    stationId: station.id,
    stationName: station.stationName,
    lineId: station.lineId,
    kric: kricInfo,
    doors: sortDoors(allDoors),
    doorsByPlf,
  };
}

export interface KricStationCodeInfo {
  railOprIsttCd: string;
  lnCd: string;
  stinCd: string;
  stinNm: string;
}

// Maps each StationRecord to its KRIC code from data-raw/kric-route-*.json
export function buildKricStationMap(
  stations: StationRecord[],
  rawDir = RAW_DIR,
): Map<string, KricStationCodeInfo> {
  const files = existsSync(rawDir)
    ? readdirSync(rawDir).filter(
        (f) =>
          f.startsWith('kric-route-') &&
          f.endsWith('.json') &&
          f !== 'kric-route-all.json',
      )
    : [];

  const kricMap = new Map<string, KricStationCodeInfo>();
  for (const file of files) {
    try {
      const content = JSON.parse(readFileSync(join(rawDir, file), 'utf8')) as {
        body?: Array<{
          railOprIsttCd: string;
          lnCd: string;
          stinCd: string;
          stinNm: string;
        }>;
      };
      for (const r of content.body || []) {
        const lineId = KRIC_LINE_TO_LINE_ID[r.lnCd];
        if (!lineId) continue;
        const name = kricKey(r.stinNm);
        kricMap.set(`${lineId}|${name}`, {
          railOprIsttCd: r.railOprIsttCd,
          lnCd: r.lnCd,
          stinCd: r.stinCd,
          stinNm: r.stinNm,
        });
      }
    } catch {
      // ignore corrupted or unreadable route file
    }
  }

  const resultMap = new Map<string, KricStationCodeInfo>();
  for (const s of stations) {
    let name = kricKey(s.stationName);
    if (name === '이수') name = '총신대입구';
    const found = kricMap.get(`${s.lineId}|${name}`);
    if (found) {
      resultMap.set(s.id, found);
    }
  }

  return resultMap;
}
