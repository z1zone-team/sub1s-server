import { existsSync } from 'fs';
import {
  CheckResult,
  KakaoPlace,
  OK_DISTANCE_M,
  classify,
} from './lib/kakao-check';
import { loadStations } from './lib/subway-common';

const ENDPOINT = 'https://api.vworld.kr/req/search';
const REQUEST_GAP_MS = 150;
// 우리 좌표 둘레 이 각도(약 3km) 안의 장소만 찾는다
const BBOX_DEG = 0.03;

// 앱 지도가 V-World라서 역 위치를 V-World 장소 검색과 맞춰 본다.
// 이용 조건(저장 가능 여부)이 문서에 없으므로 응답은 저장하지 않고 판정만 출력한다.
// usage: pnpm verify:stations-vworld [limit | --ids=ID1,ID2] [--ok=100]
async function searchStation(
  key: string,
  name: string,
  lat: number,
  lng: number,
): Promise<KakaoPlace[]> {
  const params = new URLSearchParams({
    service: 'search',
    request: 'search',
    version: '2.0',
    crs: 'EPSG:4326',
    size: '30',
    page: '1',
    query: `${name}역`,
    type: 'place',
    format: 'json',
    bbox: `${lng - BBOX_DEG},${lat - BBOX_DEG},${lng + BBOX_DEG},${lat + BBOX_DEG}`,
    key,
  });
  const res = await fetch(`${ENDPOINT}?${params.toString()}`);
  if (!res.ok) throw new Error(`V-World API HTTP ${res.status}`);
  const json = (await res.json()) as {
    response?: {
      status?: string;
      result?: { items?: { title: string; category: string; point: { x: string; y: string } }[] };
    };
  };
  const status = json.response?.status;
  if (status === 'ERROR') throw new Error('V-World API error: check VWORLD_API_KEY and its registered domain');
  return (json.response?.result?.items ?? [])
    .filter((item) => item.category.startsWith('철도시설'))
    .map((item) => ({
      place_name: item.title,
      category_group_code: 'SW8',
      x: item.point.x,
      y: item.point.y,
    }));
}

async function main(): Promise<void> {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) process.loadEnvFile?.(file);
  }
  const key = process.env.VWORLD_API_KEY;
  if (!key) throw new Error('VWORLD_API_KEY is not set in .env.local or .env');

  const okArg = process.argv.find((arg) => arg.startsWith('--ok='));
  const okDistanceM = okArg ? Number(okArg.slice('--ok='.length)) : OK_DISTANCE_M;
  if (!Number.isFinite(okDistanceM) || okDistanceM <= 0) throw new Error('--ok must be a positive number');

  const idsArg = process.argv.find((arg) => arg.startsWith('--ids='));
  const ids = idsArg ? idsArg.slice('--ids='.length).split(',') : undefined;
  const limit = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? Infinity);
  const all = loadStations();
  const stations = ids ? all.filter((s) => ids.includes(s.id)) : all.slice(0, limit);
  const results: { id: string; name: string; result: CheckResult }[] = [];

  for (const station of stations) {
    const places = await searchStation(key, station.stationName, station.lat, station.lng);
    results.push({ id: station.id, name: station.stationName, result: classify(station, places, okDistanceM) });
    await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
  }

  const count = (status: string): number => results.filter((r) => r.result.status === status).length;
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
        : 'no matching railway station';
    console.log(`  ${result.status} ${id} ${name}: ${detail}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
