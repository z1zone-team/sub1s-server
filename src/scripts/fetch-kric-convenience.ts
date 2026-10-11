import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import {
  StationDoorsRecord,
  aggregateDoors,
  buildKricStationMap,
  extractKricBody,
  parseCarNumberRows,
} from './lib/kric-convenience';
import {
  OUT_DIR,
  RAW_DIR,
  StationRecord,
  loadStations,
  readJson,
} from './lib/subway-common';

const BASE_URL = 'https://openapi.kric.go.kr/openapi';
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours caching per KRIC recommendation
const REQUEST_GAP_MS = 100; // 100ms pacing between requests

interface TransferRow {
  fromStationId: string;
  toStationId: string;
}

const API_CONFIGS = {
  stairs: {
    op: 'vulnerableUserInfo/stationStairCarNumber',
    folder: 'stairs',
    summaryFile: 'kric-stairs.json',
  },
  elevators: {
    op: 'vulnerableUserInfo/stationElevatorCarNumber',
    folder: 'elevators',
    summaryFile: 'kric-elevators.json',
  },
  platforms: {
    op: 'convenientInfo/stPlf',
    folder: 'platforms',
    summaryFile: 'kric-platforms.json',
  },
  gates: {
    op: 'convenientInfo/stationGateInfo',
    folder: 'gates',
    summaryFile: 'kric-gates.json',
  },
} as const;

type ApiType = keyof typeof API_CONFIGS;

async function fetchFromKric(
  key: string,
  op: string,
  params: { railOprIsttCd: string; lnCd: string; stinCd: string },
): Promise<string> {
  const qs = new URLSearchParams({
    serviceKey: key,
    format: 'json',
    railOprIsttCd: params.railOprIsttCd,
    lnCd: params.lnCd,
    stinCd: params.stinCd,
  });
  const res = await fetch(`${BASE_URL}/${op}?${qs.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main(): Promise<void> {
  process.loadEnvFile?.('.env');
  const key = process.env.KRIC_API_KEY;
  if (!key) throw new Error('KRIC_API_KEY is not set in .env');

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const allStations = args.includes('--all');
  const missingOnly = args.includes('--missing-only');

  const selectedApiArg = args.find((a) => a.startsWith('--api='));
  const targetApis: ApiType[] = selectedApiArg
    ? (selectedApiArg.replace('--api=', '').split(',') as ApiType[])
    : ['stairs', 'elevators', 'platforms', 'gates'];

  const stations = loadStations();
  const stationMap = buildKricStationMap(stations, RAW_DIR);

  let targetStations: StationRecord[];
  if (allStations) {
    targetStations = stations;
  } else {
    const transfers = readJson<TransferRow[]>(join(OUT_DIR, 'transfers.json'));
    const transferStationIds = new Set<string>();
    for (const t of transfers) {
      transferStationIds.add(t.fromStationId);
      transferStationIds.add(t.toStationId);
    }
    targetStations = stations.filter((s) => transferStationIds.has(s.id));
  }

  console.log(
    `[KRIC Convenience] Targeting ${targetStations.length} stations across APIs: ${targetApis.join(', ')} (force: ${force}, missingOnly: ${missingOnly})`,
  );

  const baseCacheDir = join(RAW_DIR, 'kric-convenience');
  mkdirSync(baseCacheDir, { recursive: true });

  for (const api of targetApis) {
    const config = API_CONFIGS[api];
    if (!config) continue;

    const cacheDir = join(baseCacheDir, config.folder);
    mkdirSync(cacheDir, { recursive: true });

    let cachedCount = 0;
    let fetchedCount = 0;
    let errorCount = 0;

    const summaryMap: Record<string, unknown> = {};

    console.log(`\n--- Fetching ${api} (${config.op}) ---`);

    for (let i = 0; i < targetStations.length; i += 1) {
      const station = targetStations[i];
      const kricInfo = stationMap.get(station.id);
      if (!kricInfo) continue;

      const fileKey = `${kricInfo.railOprIsttCd}_${kricInfo.lnCd}_${kricInfo.stinCd}`;
      const cachePath = join(cacheDir, `${fileKey}.json`);

      let json: unknown;
      let shouldFetch = true;

      if (existsSync(cachePath) && !force) {
        const age = Date.now() - statSync(cachePath).mtimeMs;
        if (age < MIN_INTERVAL_MS || missingOnly) {
          shouldFetch = false;
          try {
            json = JSON.parse(readFileSync(cachePath, 'utf8'));
            cachedCount += 1;
          } catch {
            shouldFetch = true;
          }
        }
      }

      if (shouldFetch) {
        try {
          const body = (
            await fetchFromKric(key, config.op, {
              railOprIsttCd: kricInfo.railOprIsttCd,
              lnCd: kricInfo.lnCd,
              stinCd: kricInfo.stinCd,
            })
          ).replace(key, '***');

          json = JSON.parse(body);
          writeFileSync(cachePath, JSON.stringify(json, null, 2));
          fetchedCount += 1;
          await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
        } catch (err) {
          errorCount += 1;
          console.error(
            `Failed ${station.id} (${station.stationName}): ${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }
      }

      if (api === 'stairs' || api === 'elevators') {
        const rows = parseCarNumberRows(json);
        const aggregated: StationDoorsRecord = aggregateDoors(
          station,
          kricInfo,
          rows,
        );
        summaryMap[station.id] = aggregated;
      } else if (api === 'platforms') {
        summaryMap[station.id] = {
          stationId: station.id,
          stationName: station.stationName,
          lineId: station.lineId,
          kric: kricInfo,
          platforms: extractKricBody(json),
        };
      } else if (api === 'gates') {
        summaryMap[station.id] = {
          stationId: station.id,
          stationName: station.stationName,
          lineId: station.lineId,
          kric: kricInfo,
          gates: extractKricBody(json),
        };
      }

      if ((i + 1) % 50 === 0 || i + 1 === targetStations.length) {
        process.stdout.write(
          `Progress: ${i + 1}/${targetStations.length} (cached: ${cachedCount}, fetched: ${fetchedCount}, errors: ${errorCount})\r`,
        );
      }
    }

    const summaryPath = join(RAW_DIR, config.summaryFile);
    writeFileSync(summaryPath, JSON.stringify(summaryMap, null, 2) + '\n');
    console.log(
      `\n${api} finished: ${Object.keys(summaryMap).length} records saved to ${config.summaryFile}`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
