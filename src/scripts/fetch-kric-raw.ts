import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseKricRoute } from './lib/kric';

const ENDPOINT =
  'https://openapi.kric.go.kr/openapi/trainUseInfo/subwayRouteInfo';
const AREA_CODE_METRO = '01';
const OUT_DIR = join(__dirname, '../../data-raw');
// KRIC asks for at most one GET per day (data refreshes quarterly), so a cached response is reused
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_GAP_MS = 1000;

// usage: pnpm fetch:kric-raw [--force] [lnCd ...]
// no lnCd = request the whole metropolitan area with a single GET
async function requestRoute(key: string, lnCd?: string): Promise<string> {
  const query = `serviceKey=${key}&format=json&mreaWideCd=${AREA_CODE_METRO}${lnCd ? `&lnCd=${lnCd}` : ''}`;
  const res = await fetch(`${ENDPOINT}?${query}`);
  const body = await res.text();
  if (!res.ok) throw new Error(`KRIC HTTP ${res.status}`);
  return body;
}

async function main(): Promise<void> {
  process.loadEnvFile?.('.env');
  const key = process.env.KRIC_API_KEY;
  if (!key) throw new Error('KRIC_API_KEY is not set in .env');

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const targets = args.filter((arg) => !arg.startsWith('--'));

  mkdirSync(OUT_DIR, { recursive: true });

  for (const lnCd of targets.length > 0 ? targets : [undefined]) {
    const label = lnCd ?? 'all';
    const jsonPath = join(OUT_DIR, `kric-route-${label}.json`);
    const rawPath = join(OUT_DIR, `kric-route-${label}.raw.txt`);

    const cachedPath = [jsonPath, rawPath].find((path) => existsSync(path));
    if (cachedPath && !force) {
      const age = Date.now() - statSync(cachedPath).mtimeMs;
      if (age < MIN_INTERVAL_MS) {
        console.log(
          `${label}: skipped, a response was saved ${(age / 3600000).toFixed(1)}h ago (use --force to call again)`,
        );
        continue;
      }
    }

    const body = (await requestRoute(key, lnCd)).replace(key, '***');
    writeFileSync(rawPath, body);

    let json: unknown;
    try {
      json = JSON.parse(body) as unknown;
    } catch {
      throw new Error(
        `KRIC did not return JSON, raw response saved to ${rawPath}`,
      );
    }
    writeFileSync(jsonPath, JSON.stringify(json, null, 2));
    const rows = parseKricRoute(json);
    const routes = new Set(rows.map((r) => `${r.lnCd}|${r.routCd}`));
    console.log(
      `${label}: ${rows.length} rows, ${routes.size} routes -> data-raw/kric-route-${label}.json`,
    );
    await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
