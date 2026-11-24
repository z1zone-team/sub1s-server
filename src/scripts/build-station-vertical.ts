/**
 * 계단 축 자료(src/data/subway/station-vertical.json)를 만든다.
 *
 * 입력(모두 data-raw, git 제외):
 * - kric-movement/elevator/{운영기관}_{노선}_{역}.json: KRIC 역사별 엘리베이터 이동동선(799역)
 * - seoul-escalator/OA-12514_*.xlsx: 서울교통공사 엘리베이터·에스컬레이터 길이·높이(1~8호선)
 *
 * 규칙(docs STAIRS_AXIS_DESIGN.md, 2026-11-24 사용자 결정):
 * - 출입구-승강장: 출구별 경로의 오르내림(오른 층 + 내린 층) 중앙값
 * - 환승: transfers.json의 환승 한 칸마다, 출발역 파일의 환승 경로 중 글에 도착 노선이 나오는 경로의 중앙값.
 *   그런 경로가 없으면 그 역 환승 경로 전체의 중앙값. 환승 경로가 없는 역은 넣지 않는다(서버가 계단 축을 빼고 안내)
 * - 높이: 경로가 지나는 층 구간마다 그 역의 같은 구간 서울교통공사 승강기 높이(중앙값)를 쓰고, 없으면 그 역의 한 층 높이
 *   중앙값(승강기 "높이 / 지나는 층 수"), 그것도 없으면 전체 기본값 5.8m x 층 수. 오른 높이와 내린 높이를 1:1로 더한다
 *
 * 실행: pnpm build:station-vertical
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Workbook } from 'exceljs';
import { buildKricStationMap } from './lib/kric-convenience';
import { OUT_DIR, RAW_DIR, loadStations, readJson } from './lib/subway-common';
import {
  baseStationName,
  Level,
  MeasuredSpan,
  median,
  mentionsLine,
  pathLevels,
  pathMeters,
  rangeLevels,
  travel,
} from './lib/station-vertical';
import {
  StationVerticalFile,
  transferKey,
} from '../domain/facility/models/station-vertical';

const DEFAULT_LEVEL_HEIGHT_M = 5.8;
const SEOUL_METRO_LINES = new Set([
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
]);

interface MovementRow {
  mvPathMgNo: number;
  mvPathDvCd: string;
  mvTpOrdr: number;
  mvContDtl: string;
}

/** 경로 구분(1 출입구-승강장, 3 환승경로)별로 경로 번호마다 단계 글을 순서대로 모은다 */
function pathsOf(rows: MovementRow[], kind: '1' | '3'): string[][] {
  const groups = new Map<number, MovementRow[]>();
  for (const row of rows.filter((r) => r.mvPathDvCd === kind)) {
    const list = groups.get(row.mvPathMgNo) ?? [];
    list.push(row);
    groups.set(row.mvPathMgNo, list);
  }
  return [...groups.values()].map((list) =>
    list.sort((a, b) => a.mvTpOrdr - b.mvTpOrdr).map((r) => r.mvContDtl ?? ''),
  );
}

interface StationHeights {
  spans: MeasuredSpan[];
  levelHeightM: number;
  source: 'SEOUL_METRO' | 'DEFAULT';
}

/** 한 경로의 오르내리는 층 수와 높이. 층을 읽지 못하면 null */
function measure(
  steps: string[],
  fromExit: boolean,
  heights: StationHeights,
): { levels: number; meters: number } | null {
  const levels: Level[] | null = pathLevels(steps, fromExit);
  if (!levels) return null;
  const count = travel(levels);
  const meters = pathMeters(levels, heights.spans, heights.levelHeightM);
  return { levels: count.up + count.down, meters: meters.up + meters.down };
}

const round = (x: number) => Math.round(x * 100) / 100;

/** 서울교통공사 파일에서 역명(괄호 뗀 이름)별 승강기 구간과 높이(m) */
async function seoulMetroSpans(): Promise<Map<string, MeasuredSpan[]>> {
  const dir = join(RAW_DIR, 'seoul-escalator');
  const file = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.startsWith('OA-12514') && f.endsWith('.xlsx'))
        .sort()
        .pop()
    : undefined;
  const heights = new Map<string, MeasuredSpan[]>();
  if (!file) {
    console.warn(
      '[station-vertical] OA-12514 xlsx not found, every station uses the default height',
    );
    return heights;
  }
  const workbook = new Workbook();
  await workbook.xlsx.readFile(join(dir, file));
  for (const sheet of workbook.worksheets) {
    // 머리글 행에서 역명, 운행구간, 높이 열을 찾는다(엘리베이터: 승강행정 mm, 에스컬레이터: 설치높이 m)
    let header:
      | {
          row: number;
          name: number;
          range: number;
          height: number;
          mm: boolean;
        }
      | undefined;
    sheet.eachRow((row, rowNumber) => {
      if (header) return;
      // row.values는 빈칸이 있는 배열이라 Array.from으로 채운 뒤 읽는다
      const cells = Array.from(row.values as unknown[], (v) =>
        String(v ?? '').replace(/\s+/g, ''),
      );
      const name = cells.findIndex((c) => c === '역명');
      const range = cells.findIndex((c) => c.startsWith('운행구간'));
      const mm = cells.findIndex((c) => c.startsWith('승강행정'));
      const m = cells.findIndex((c) => c.startsWith('설치높이'));
      if (name > 0 && range > 0 && (mm > 0 || m > 0))
        header = {
          row: rowNumber,
          name,
          range,
          height: mm > 0 ? mm : m,
          mm: mm > 0,
        };
    });
    if (!header) continue;
    const h = header;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= h.row) return;
      const values = Array.from(row.values as unknown[]);
      const name = String(values[h.name] ?? '').trim();
      const range = rangeLevels(String(values[h.range] ?? ''));
      const raw = Number(String(values[h.height] ?? '').replace(/,/g, ''));
      if (!name || !range || !Number.isFinite(raw) || raw <= 0) return;
      const meters = h.mm ? raw / 1000 : raw;
      const key = baseStationName(name);
      heights.set(key, [
        ...(heights.get(key) ?? []),
        { from: range[0], to: range[1], meters },
      ]);
    });
  }
  console.log(
    `[station-vertical] ${file}: elevator and escalator spans for ${heights.size} station names`,
  );
  return heights;
}

async function main(): Promise<void> {
  const stations = loadStations();
  const kric = buildKricStationMap(stations, RAW_DIR);
  const movementDir = join(RAW_DIR, 'kric-movement', 'elevator');
  const spansByName = await seoulMetroSpans();
  const heightsOf = (stationId: string): StationHeights => {
    const station = stations.find((s) => s.id === stationId)!;
    const spans = SEOUL_METRO_LINES.has(station.lineId)
      ? (spansByName.get(station.stationName.replace(/역$/, '')) ?? [])
      : [];
    const perLevel = median(
      spans.map((s) => s.meters / Math.abs(s.from - s.to)),
    );
    return perLevel
      ? { spans, levelHeightM: perLevel, source: 'SEOUL_METRO' }
      : { spans: [], levelHeightM: DEFAULT_LEVEL_HEIGHT_M, source: 'DEFAULT' };
  };
  const transfers = readJson<
    Array<{ fromStationId: string; toStationId: string }>
  >(join(OUT_DIR, 'transfers.json'));
  const lineOf = new Map(stations.map((s) => [s.id, s.lineId]));

  const rowsOf = new Map<string, MovementRow[]>();
  for (const station of stations) {
    const k = kric.get(station.id);
    if (!k) continue;
    const path = join(
      movementDir,
      `${k.railOprIsttCd}_${k.lnCd}_${k.stinCd}.json`,
    );
    if (!existsSync(path)) continue;
    const body = (
      JSON.parse(readFileSync(path, 'utf8')) as { body?: MovementRow[] }
    ).body;
    if (Array.isArray(body)) rowsOf.set(station.id, body);
  }

  const out: StationVerticalFile = {
    version: 1,
    defaultLevelHeightM: DEFAULT_LEVEL_HEIGHT_M,
    stations: {},
    transfers: {},
  };
  let measuredHeights = 0;
  for (const station of stations) {
    const rows = rowsOf.get(station.id);
    if (!rows) continue;
    const heights = heightsOf(station.id);
    const measured = pathsOf(rows, '1')
      .map((steps) => measure(steps, true, heights))
      .filter((x): x is { levels: number; meters: number } => x !== null);
    if (measured.length === 0) continue;
    if (heights.source === 'SEOUL_METRO') measuredHeights += 1;
    out.stations[station.id] = {
      exitMeters: round(median(measured.map((m) => m.meters))!),
      exitLevels: median(measured.map((m) => m.levels))!,
      heightSource: heights.source,
    };
  }

  let matched = 0;
  let fallback = 0;
  for (const { fromStationId, toStationId } of transfers) {
    const rows = rowsOf.get(fromStationId);
    const toLine = lineOf.get(toStationId);
    if (!rows || !toLine) continue;
    const heights = heightsOf(fromStationId);
    const parsed = pathsOf(rows, '3').flatMap((steps) => {
      const m = measure(steps, false, heights);
      return m ? [{ steps, ...m }] : [];
    });
    if (parsed.length === 0) continue;
    const toTarget = parsed.filter((p) =>
      mentionsLine(p.steps.join(' '), toLine),
    );
    const chosen = toTarget.length > 0 ? toTarget : parsed;
    out.transfers[transferKey(fromStationId, toStationId)] = {
      meters: round(median(chosen.map((p) => p.meters))!),
      levels: median(chosen.map((p) => p.levels))!,
      matchedLine: toTarget.length > 0,
    };
    if (toTarget.length > 0) matched += 1;
    else fallback += 1;
  }

  writeFileSync(
    join(OUT_DIR, 'station-vertical.json'),
    `${JSON.stringify(out, null, 2)}\n`,
  );
  console.log(
    `[station-vertical] stations ${Object.keys(out.stations).length}/${stations.length} (Seoul Metro heights ${measuredHeights}), ` +
      `transfers ${matched + fallback}/${transfers.length} (line matched ${matched}, station median ${fallback})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
