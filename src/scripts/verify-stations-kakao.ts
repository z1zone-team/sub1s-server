import { existsSync } from 'fs';
import {
  CheckResult,
  KakaoPlace,
  OK_DISTANCE_M,
  SEARCH_RADIUS_M,
  classify,
} from './lib/kakao-check';
import { loadStations } from './lib/subway-common';

const ENDPOINT = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const REQUEST_GAP_MS = 150;

// One-off verification of the station list against Kakao Local API.
// Kakao forbids storing API responses, so nothing is written to disk: only the verdicts are printed.
// usage: pnpm verify:stations-kakao [limit | --ids=ID1,ID2] [--ok=300]
// --ok=N: a station within N meters of the Kakao place is OK (default 300). Smaller values find smaller shifts
async function searchStation(
  key: string,
  name: string,
  lat: number,
  lng: number,
): Promise<KakaoPlace[]> {
  const params = new URLSearchParams({
    query: `${name}역`,
    category_group_code: 'SW8',
    x: String(lng),
    y: String(lat),
    radius: String(SEARCH_RADIUS_M),
    sort: 'distance',
    size: '15',
  });
  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    headers: { Authorization: `KakaoAK ${key}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Kakao API rejected the key (HTTP ${res.status}). Check KAKAO_REST_API_KEY and that the Kakao Map service is enabled for the app.`,
    );
  }
  if (!res.ok) throw new Error(`Kakao API HTTP ${res.status}`);
  const json = (await res.json()) as { documents?: KakaoPlace[] };
  return json.documents ?? [];
}

async function main(): Promise<void> {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) process.loadEnvFile?.(file);
  }
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) throw new Error('KAKAO_REST_API_KEY is not set in .env.local or .env');

  const okArg = process.argv.find((arg) => arg.startsWith('--ok='));
  const okDistanceM = okArg ? Number(okArg.slice('--ok='.length)) : OK_DISTANCE_M;
  if (!Number.isFinite(okDistanceM) || okDistanceM <= 0) throw new Error('--ok must be a positive number');

  // usage: [limit] or --ids=ID1,ID2
  const idsArg = process.argv.find((arg) => arg.startsWith('--ids='));
  const ids = idsArg ? idsArg.slice('--ids='.length).split(',') : undefined;
  const limit = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? Infinity);
  const all = loadStations();
  const stations = ids
    ? all.filter((s) => ids.includes(s.id))
    : all.slice(0, limit);
  const results: { id: string; name: string; result: CheckResult }[] = [];

  for (const station of stations) {
    const places = await searchStation(
      key,
      station.stationName,
      station.lat,
      station.lng,
    );
    results.push({
      id: station.id,
      name: station.stationName,
      result: classify(station, places, okDistanceM),
    });
    await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
  }

  const count = (status: string): number =>
    results.filter((r) => r.result.status === status).length;
  console.log(
    `checked ${results.length} (OK within ${okDistanceM}m): OK ${count('OK')}, FAR ${count('FAR')}, NOT_FOUND ${count('NOT_FOUND')}`,
  );
  const farFirst = [...results].sort(
    (a, b) => (b.result.distanceM ?? Infinity) - (a.result.distanceM ?? Infinity),
  );
  for (const { id, name, result } of farFirst) {
    if (result.status === 'OK') continue;
    const detail =
      result.status === 'FAR'
        ? `${result.placeName} is ${Math.round(result.distanceM ?? 0)}m away`
        : 'no matching subway station';
    console.log(`  ${result.status} ${id} ${name}: ${detail}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
