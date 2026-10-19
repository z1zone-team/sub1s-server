import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildKricStationMap } from './lib/kric-convenience';
import { RAW_DIR, StationRecord, loadStations } from './lib/subway-common';

/**
 * KRIC가 휴일 시간표를 주지 않는 노선(2호선, 7호선)의 시간표를 서울 열린데이터광장 "역별 열차 시간표"로 받는다.
 *   pnpm fetch:seoul-timetables              일요일, 공휴일(WEEK_TAG=3)의 2호선, 7호선
 *   pnpm fetch:seoul-timetables -- --day=1 --lines=02   평일, 2호선
 * 키는 SEOUL_OPEN_API_KEY(.env.local 또는 .env)에서 읽고 출력하지 않는다
 */
const ENDPOINT = 'http://openapi.seoul.go.kr:8088';
const SERVICE = 'SearchSTNTimeTableByIDService';
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_GAP_MS = 150;
const INOUT_TAGS = ['1', '2'];
const DEFAULT_LINES = ['02', '07'];

export function seoulTimetableDir(weekTag: string): string {
  return join(RAW_DIR, `seoul-timetables-${weekTag}`);
}

/** 서울 역 코드. 2호선은 KRIC 역 코드 앞에 0을 붙인 4자리, 7호선은 KRIC 역 코드와 같다 */
function seoulStationCode(lineId: string, stinCd: string): string {
  return lineId === '02' ? stinCd.padStart(4, '0') : stinCd;
}

async function fetchTimetable(key: string, code: string, weekTag: string, inoutTag: string): Promise<string> {
  const url = `${ENDPOINT}/${key}/json/${SERVICE}/1/1000/${code}/${weekTag}/${inoutTag}/`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.text()).replaceAll(key, '***');
}

async function main(): Promise<void> {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) process.loadEnvFile?.(file);
  }
  const key = process.env.SEOUL_OPEN_API_KEY;
  if (!key) throw new Error('SEOUL_OPEN_API_KEY is not set in .env.local or .env');

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const weekTag = args.find((a) => a.startsWith('--day='))?.replace('--day=', '') ?? '3';
  if (!['1', '2', '3'].includes(weekTag)) throw new Error('--day must be 1 (weekday), 2 (saturday) or 3 (sunday, holiday)');
  const lines = args.find((a) => a.startsWith('--lines='))?.replace('--lines=', '').split(',') ?? DEFAULT_LINES;

  const stations: StationRecord[] = loadStations().filter((s) => lines.includes(s.lineId));
  const kricMap = buildKricStationMap(stations);
  const dir = seoulTimetableDir(weekTag);
  mkdirSync(dir, { recursive: true });

  let fetched = 0;
  let cached = 0;
  let empty = 0;
  let errors = 0;
  for (const station of stations) {
    const kric = kricMap.get(station.id);
    if (!kric) continue;
    const code = seoulStationCode(station.lineId, kric.stinCd);

    for (const inout of INOUT_TAGS) {
      const file = join(dir, `${station.id}_${inout}.json`);
      if (!force && existsSync(file) && Date.now() - statSync(file).mtimeMs < MIN_INTERVAL_MS) {
        cached += 1;
        continue;
      }
      try {
        const text = await fetchTimetable(key, code, weekTag, inout);
        const body = JSON.parse(text) as Record<string, { row?: unknown[] }>;
        if (!body[SERVICE]?.row?.length) empty += 1;
        writeFileSync(file, text, 'utf-8');
        fetched += 1;
        await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
      } catch (err) {
        errors += 1;
        console.warn(`Error fetching ${station.id} ${station.stationName} (${inout}):`, (err as Error).message);
      }
    }
  }
  console.log(
    `[Seoul Timetable] day ${weekTag}, lines ${lines.join(',')}: ${stations.length} stations, ${fetched} fetched, ${cached} cached, ${empty} empty, ${errors} errors -> ${dir}`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[Seoul Timetable] Fatal error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
