import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  Bbox,
  OVERPASS_ENDPOINTS,
  OsmRailwaysFile,
  OsmWay,
  bboxOf,
  buildOverpassQuery,
  cellsNearPoints,
  dedupeWays,
  parseOverpass,
  splitBbox,
} from './lib/osm-railways';
import { RAW_DIR, loadStations } from './lib/subway-common';

/**
 * 수도권 철도 선로(OpenStreetMap)를 Overpass API로 한 번 받아 data-raw에 저장한다.
 *   pnpm fetch:osm-railways            24시간 안에 받은 파일이 있으면 호출하지 않는다
 *   pnpm fetch:osm-railways -- --force 받은 파일이 있어도 다시 호출한다
 * 큰 영역은 공개 서버가 받아 주지 않아 0.3도 칸으로 나눠 칸마다 미러를 차례로 한 번씩 시도하고, 칸 사이에 간격을 둔다. 실패한 칸은 4칸으로 쪼개 다시 요청하고(최대 2번), 받은 칸은 `osm-railways-cells/`에 남겨 다시 실행해도 호출하지 않는다. 끝내 못 받은 칸이 있으면 저장하지 않고 멈춘다.
 * OSM 데이터는 ODbL이라 출처 표시(© OpenStreetMap contributors)가 필요하다. 원본은 저장소에 올리지 않는다
 */
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const OUT_FILE = join(RAW_DIR, 'osm-railways.json');
const CELL_DIR = join(RAW_DIR, 'osm-railways-cells');
const CELL_DEG = 0.3;
const MAX_SPLIT_DEPTH = 2;
const GAP_MS = 3_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchCell(query: string): Promise<{ ways: OsmWay[]; endpoint: string }> {
  const errors: string[] = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'sub1s-track-shapes/1.0 (team project)',
        },
        body: new URLSearchParams({ data: query }).toString(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ways: parseOverpass(await res.json()), endpoint };
    } catch (err) {
      errors.push(`${endpoint}: ${err instanceof Error ? err.message : String(err)}`);
      await sleep(GAP_MS);
    }
  }
  throw new Error(errors.join(' | '));
}

/** 받은 칸은 파일로 남겨 다시 실행해도 호출하지 않고, 실패한 칸은 4칸으로 쪼개 다시 요청한다 */
async function loadCell(cell: Bbox, depth: number, used: Set<string>): Promise<OsmWay[]> {
  const key = [cell.south, cell.west, cell.north, cell.east].map((v) => v.toFixed(4)).join('_');
  const cachePath = join(CELL_DIR, `${key}.json`);
  if (existsSync(cachePath) && Date.now() - statSync(cachePath).mtimeMs < MIN_INTERVAL_MS) {
    return (JSON.parse(readFileSync(cachePath, 'utf-8')) as { ways: OsmWay[] }).ways;
  }
  try {
    const { ways, endpoint } = await fetchCell(buildOverpassQuery(cell));
    used.add(endpoint);
    mkdirSync(CELL_DIR, { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ ways }), 'utf-8');
    console.log(`[OSM Railways] ${key}: ${ways.length} ways (${endpoint})`);
    await sleep(GAP_MS);
    return ways;
  } catch (err) {
    if (depth >= MAX_SPLIT_DEPTH) throw err;
    console.warn(`[OSM Railways] ${key} failed, splitting: ${err instanceof Error ? err.message : String(err)}`);
    const half = (cell.north - cell.south) / 2;
    const parts: OsmWay[][] = [];
    for (const sub of splitBbox(cell, half)) parts.push(await loadCell(sub, depth + 1, used));
    return parts.flat();
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  if (!force && existsSync(OUT_FILE) && Date.now() - statSync(OUT_FILE).mtimeMs < MIN_INTERVAL_MS) {
    console.log(`[OSM Railways] cached (< 24h), skipped: ${OUT_FILE}`);
    return;
  }

  const stations = loadStations();
  const bbox = bboxOf(stations);
  const cells = cellsNearPoints(splitBbox(bbox, CELL_DEG), stations);
  console.log(`[OSM Railways] ${cells.length} cells of ${CELL_DEG} degrees near stations`);

  const all: OsmWay[] = [];
  const used = new Set<string>();
  for (const cell of cells) all.push(...(await loadCell(cell, 0, used)));

  const ways = dedupeWays(all);
  if (ways.length === 0) throw new Error('no railway ways found');
  const file: OsmRailwaysFile = { fetchedAt: new Date().toISOString(), endpoint: [...used].join(', '), bbox, ways };
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(file), 'utf-8');
  console.log(`[OSM Railways] ${ways.length} ways saved to ${OUT_FILE}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[OSM Railways] Fatal error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
