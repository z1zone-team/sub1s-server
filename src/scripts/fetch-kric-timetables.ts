import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { buildKricStationMap } from './lib/kric-convenience';
import {
  InterStationDuration,
  KricTimetableRow,
  analyzeTimetableDurations,
} from './lib/kric-timetable';
import {
  OUT_DIR,
  RAW_DIR,
  StationRecord,
  loadStations,
  readJson,
} from './lib/subway-common';

const ENDPOINT =
  'https://openapi.kric.go.kr/openapi/trainUseInfo/subwayTimetableExp';
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours caching per KRIC recommendation
const REQUEST_GAP_MS = 100; // 100ms pacing between requests

interface EdgeRow {
  fromStationId: string;
  toStationId: string;
  lineId: string;
  isEstimated: boolean;
}

interface ApiResponse<T> {
  header?: {
    resultCnt?: number;
    resultCode?: string;
    resultMsg?: string;
  };
  body?: T[];
}

async function fetchStationTimetable(
  key: string,
  opr: string,
  ln: string,
  stin: string,
): Promise<string> {
  const qs = new URLSearchParams({
    serviceKey: key,
    format: 'json',
    dayCd: '8', // 평일
    railOprIsttCd: opr,
    lnCd: ln,
    stinCd: stin,
  });
  const res = await fetch(`${ENDPOINT}?${qs.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main(): Promise<void> {
  process.loadEnvFile?.('.env');
  const key = process.env.KRIC_API_KEY;
  if (!key) throw new Error('KRIC_API_KEY is not set in .env');

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const allLines = args.includes('--all');

  const linesFilterArg = args.find((a) => a.startsWith('--lines='));
  const specifiedLines = linesFilterArg
    ? new Set(linesFilterArg.replace('--lines=', '').split(','))
    : null;

  const stations = loadStations();
  const stationMap = buildKricStationMap(stations, RAW_DIR);

  const edges = readJson<EdgeRow[]>(join(OUT_DIR, 'edges.json'));
  const estimatedLines = new Set<string>();
  for (const edge of edges) {
    if (edge.isEstimated) {
      estimatedLines.add(edge.lineId);
    }
  }

  let targetStations: StationRecord[];
  if (specifiedLines) {
    targetStations = stations.filter((s) => specifiedLines.has(s.lineId));
  } else if (allLines) {
    targetStations = stations;
  } else {
    // Priority: target lines with estimated edges (GA, AR, SB, 09, etc.)
    targetStations = stations.filter((s) => estimatedLines.has(s.lineId));
  }

  console.log(
    `[KRIC Timetable] Targeting ${targetStations.length} stations across lines (force: ${force})`,
  );

  const cacheDir = join(RAW_DIR, 'kric-timetables');
  mkdirSync(cacheDir, { recursive: true });

  const allRows: KricTimetableRow[] = [];
  let fetchedCount = 0;
  let cachedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < targetStations.length; i += 1) {
    const station = targetStations[i];
    const kric = stationMap.get(station.id);
    if (!kric) continue;

    const cacheFile = join(
      cacheDir,
      `${kric.railOprIsttCd}_${kric.lnCd}_${kric.stinCd}.json`,
    );

    let jsonStr: string | null = null;

    if (existsSync(cacheFile) && !force) {
      const age = Date.now() - statSync(cacheFile).mtimeMs;
      if (age < MIN_INTERVAL_MS) {
        jsonStr = readFileSync(cacheFile, 'utf-8');
      }
    }

    if (!jsonStr) {
      try {
        const raw = await fetchStationTimetable(
          key,
          kric.railOprIsttCd,
          kric.lnCd,
          kric.stinCd,
        );
        jsonStr = raw.replaceAll(key, '***');
        writeFileSync(cacheFile, jsonStr, 'utf-8');
        fetchedCount += 1;
        await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
      } catch (err) {
        errorCount += 1;
        console.warn(
          `[${i + 1}/${targetStations.length}] Error fetching ${station.stationName} (${kric.stinCd}):`,
          (err as Error).message,
        );
        continue;
      }
    } else {
      cachedCount += 1;
    }

    try {
      const parsed = JSON.parse(jsonStr) as ApiResponse<KricTimetableRow>;
      if (parsed.body && Array.isArray(parsed.body)) {
        allRows.push(...parsed.body);
      }
    } catch {
      // JSON parse error
    }

    if ((i + 1) % 50 === 0 || i + 1 === targetStations.length) {
      console.log(
        `[Progress] ${i + 1}/${targetStations.length} stations processed (${cachedCount} cached, ${fetchedCount} fetched, ${errorCount} errors, ${allRows.length} timetable rows)`,
      );
    }
  }

  console.log(
    `[KRIC Timetable] Aggregation complete: ${allRows.length} timetable records collected.`,
  );

  console.log(`[KRIC Timetable] Analyzing inter-station durations...`);
  const durations: InterStationDuration[] = analyzeTimetableDurations(allRows);
  console.log(
    `[KRIC Timetable] Derived ${durations.length} directed inter-station durations (${durations.filter((d) => d.isExpress).length} express).`,
  );

  const summaryPath = join(RAW_DIR, 'kric-durations.json');
  writeFileSync(summaryPath, JSON.stringify(durations, null, 2), 'utf-8');
  console.log(`[KRIC Timetable] Saved duration summary to ${summaryPath}`);
}

main().catch((err) => {
  console.error('[KRIC Timetable] Fatal error:', err);
  process.exit(1);
});
