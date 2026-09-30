import { join } from 'path';
import { stationKey } from './lib/kakao-check';
import {
  OdsayPath,
  adjacencyKey,
  checkTopology,
  summarize,
} from './lib/odsay-check';
import { OUT_DIR, loadStations, readJson } from './lib/subway-common';

const ENDPOINT = 'https://api.odsay.com/v1/api/searchPubTransPathT';
const REQUEST_GAP_MS = 1000;
// the ODsay free plan allows 30 calls a day; stay well below it
const MAX_CALLS = 10;

const CASES: { from: string; to: string; purpose: string }[] = [
  { from: '강동', to: '마천', purpose: '5호선 분기 직통' },
  { from: '상일동', to: '마천', purpose: '5호선 분기 양쪽 간 이동' },
  { from: '광명', to: '금천구청', purpose: '광명 셔틀' },
  { from: '광명', to: '가산디지털단지', purpose: '광명 셔틀 이후 경유' },
  { from: '청량리', to: '평내호평', purpose: '경춘선 상봉 부근' },
  { from: '구산', to: '응암', purpose: '6호선 응암순환' },
  { from: '서울역', to: '가좌', purpose: '경의중앙선 신촌 분기' },
  { from: '신도림', to: '까치산', purpose: '2호선 지선' },
  { from: '서울역', to: '인천공항1터미널', purpose: '공항철도' },
  { from: '서울역', to: '운정중앙', purpose: 'GTX-A' },
  { from: '응암', to: '구산', purpose: '6호선 응암순환 반대 방향' },
];

interface Point {
  lat: number;
  lng: number;
}

// One-off spot check against ODsay. Responses are never written to disk: only verdicts are printed.
// usage: pnpm verify:routes-odsay [caseNumber ...]
async function search(
  key: string,
  from: Point,
  to: Point,
): Promise<OdsayPath | undefined> {
  const params = new URLSearchParams({
    SX: String(from.lng),
    SY: String(from.lat),
    EX: String(to.lng),
    EY: String(to.lat),
    SearchPathType: '1',
    apiKey: key,
  });
  const res = await fetch(`${ENDPOINT}?${params.toString()}`);
  if (!res.ok) throw new Error(`ODsay HTTP ${res.status}`);
  const json = (await res.json()) as {
    error?: { code?: string; msg?: string } | { code?: string; msg?: string }[];
    result?: { path?: OdsayPath[] };
  };
  if (json.error) {
    // the error body carries no key; print it whole so the failure can be diagnosed
    throw new Error(`ODsay error: ${JSON.stringify(json.error)}`);
  }
  return json.result?.path?.[0];
}

async function main(): Promise<void> {
  process.loadEnvFile?.('.env');
  const key = process.env.ODSAY_API_KEY;
  if (!key) throw new Error('ODSAY_API_KEY is not set in .env');

  const picked = process.argv
    .slice(2)
    .filter((a) => /^\d+$/.test(a))
    .map(Number);
  const numbers = picked.length ? picked : CASES.map((_, i) => i + 1);
  if (numbers.length > MAX_CALLS) {
    throw new Error(`refusing more than ${MAX_CALLS} calls in one run`);
  }

  const stations = loadStations();
  const nameById = new Map(
    stations.map((s) => [s.id, stationKey(s.stationName)]),
  );
  const knownNames = new Set(nameById.values());
  const links = new Set<string>();
  const edges = readJson<{ fromStationId: string; toStationId: string }[]>(
    join(OUT_DIR, 'edges.json'),
  );
  for (const edge of edges) {
    const a = nameById.get(edge.fromStationId);
    const b = nameById.get(edge.toStationId);
    if (a && b) links.add(adjacencyKey(a, b));
  }
  const find = (name: string) =>
    stations.find((s) => stationKey(s.stationName) === stationKey(name));

  let calls = 0;
  for (const n of numbers) {
    const c = CASES[n - 1];
    const from = c && find(c.from);
    const to = c && find(c.to);
    if (!c || !from || !to) {
      console.log(`#${n} skipped: station not found in our data`);
      continue;
    }
    if (calls > 0) await new Promise((r) => setTimeout(r, REQUEST_GAP_MS));
    calls += 1;
    const path = await search(key, from, to);
    if (!path) {
      console.log(`#${n} ${c.from}->${c.to} (${c.purpose}): no path returned`);
      continue;
    }
    const summary = summarize(path);
    const verdict = checkTopology(summary, knownNames, links);
    const ok =
      verdict.brokenLinks.length === 0 && verdict.unknownStations.length === 0;
    console.log(
      `#${n} ${c.from}->${c.to} (${c.purpose}): ${ok ? 'TOPOLOGY OK' : 'TOPOLOGY MISMATCH'}, ` +
        `transfers ${summary.transfers}, fare ${summary.fare}, ${summary.minutes} min`,
    );
    for (const ride of summary.rides) {
      const last = ride.stations[ride.stations.length - 1];
      console.log(
        `    ${ride.line}: ${ride.stations[0]} .. ${last} (${ride.stations.length} stations)`,
      );
    }
    if (verdict.brokenLinks.length) {
      console.log(
        `    links missing in ours: ${verdict.brokenLinks.join(', ')}`,
      );
    }
    if (verdict.unknownStations.length) {
      console.log(
        `    unknown stations: ${verdict.unknownStations.join(', ')}`,
      );
    }
  }
  console.log(`calls made: ${calls} (free plan: 30 per day)`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
