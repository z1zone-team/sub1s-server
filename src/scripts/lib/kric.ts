// KRIC 도시철도 전체노선정보 (openapi.kric.go.kr/openapi/trainUseInfo/subwayRouteInfo) response handling.
// The JSON envelope is not documented, so rows are located by their field names instead of a fixed path.

export interface KricRouteRow {
  lnCd: string;
  mreaWideCd: string;
  railOprIsttCd: string;
  routCd: string;
  routNm: string;
  stinCd: string;
  stinConsOrdr: number;
  stinNm: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRouteRecord(value: unknown): value is JsonRecord {
  return isRecord(value) && 'stinNm' in value && 'stinConsOrdr' in value;
}

function collectRouteRecords(node: unknown, found: JsonRecord[]): void {
  if (isRouteRecord(node)) {
    found.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectRouteRecords(child, found);
  } else if (isRecord(node)) {
    for (const child of Object.values(node)) collectRouteRecords(child, found);
  }
}

function findResultError(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const error = findResultError(child);
      if (error) return error;
    }
    return undefined;
  }
  if (!isRecord(node)) return undefined;
  const code = node.resultCode;
  if (typeof code === 'string' && code !== '00' && code !== '0') {
    return `resultCode=${code} ${String(node.resultMsg ?? '')}`.trim();
  }
  for (const child of Object.values(node)) {
    const error = findResultError(child);
    if (error) return error;
  }
  return undefined;
}

function text(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`KRIC row is missing "${key}"`);
  }
  return String(value).trim();
}

export function parseKricRoute(json: unknown): KricRouteRow[] {
  const error = findResultError(json);
  if (error) throw new Error(`KRIC error: ${error}`);

  const records: JsonRecord[] = [];
  collectRouteRecords(json, records);

  return records.map((record) => {
    const order = Number(text(record, 'stinConsOrdr'));
    if (!Number.isFinite(order)) {
      throw new Error(
        `KRIC row has a non-numeric stinConsOrdr: ${String(record.stinConsOrdr)}`,
      );
    }
    return {
      lnCd: text(record, 'lnCd'),
      mreaWideCd: text(record, 'mreaWideCd'),
      railOprIsttCd: text(record, 'railOprIsttCd'),
      routCd: text(record, 'routCd'),
      routNm: text(record, 'routNm'),
      stinCd: text(record, 'stinCd'),
      stinConsOrdr: order,
      stinNm: text(record, 'stinNm'),
    };
  });
}

export interface KricRoute {
  lnCd: string;
  routCd: string;
  routNm: string;
  stations: KricRouteRow[];
}

// one route = one lnCd + routCd, stations sorted from 상행 to 하행 (ascending stinConsOrdr)
export function groupRoutes(rows: KricRouteRow[]): KricRoute[] {
  const routes = new Map<string, KricRoute>();
  for (const row of rows) {
    const key = `${row.lnCd}|${row.routCd}`;
    const route = routes.get(key) ?? {
      lnCd: row.lnCd,
      routCd: row.routCd,
      routNm: row.routNm,
      stations: [],
    };
    route.stations.push(row);
    routes.set(key, route);
  }
  for (const route of routes.values()) {
    route.stations.sort((a, b) => a.stinConsOrdr - b.stinConsOrdr);
  }
  return [...routes.values()];
}
