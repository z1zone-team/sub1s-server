import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseKricRoute } from './lib/kric';

const ENDPOINT =
  'https://openapi.kric.go.kr/openapi/trainUseInfo/subwayRouteInfo';
const AREA_CODE_METRO = '01';
const OUT_DIR = join(__dirname, '../../data-raw');

// usage: pnpm fetch:kric-raw [lnCd ...]   (no lnCd = request the whole metropolitan area at once)
async function fetchRoute(key: string, lnCd?: string): Promise<unknown> {
  const query = `serviceKey=${key}&format=json&mreaWideCd=${AREA_CODE_METRO}${lnCd ? `&lnCd=${lnCd}` : ''}`;
  const res = await fetch(`${ENDPOINT}?${query}`);
  const body = await res.text();
  if (!res.ok) throw new Error(`KRIC HTTP ${res.status}`);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(
      `KRIC did not return JSON: ${body.slice(0, 200).replace(key, '***')}`,
    );
  }
}

async function main(): Promise<void> {
  process.loadEnvFile?.('.env');
  const key = process.env.KRIC_API_KEY;
  if (!key) throw new Error('KRIC_API_KEY is not set in .env');

  mkdirSync(OUT_DIR, { recursive: true });
  const targets = process.argv.slice(2);

  for (const lnCd of targets.length > 0 ? targets : [undefined]) {
    const json = await fetchRoute(key, lnCd);
    const label = lnCd ?? 'all';
    writeFileSync(
      join(OUT_DIR, `kric-route-${label}.json`),
      JSON.stringify(json, null, 2),
    );
    const rows = parseKricRoute(json);
    const routes = new Set(rows.map((r) => `${r.lnCd}|${r.routCd}`));
    console.log(
      `${label}: ${rows.length} rows, ${routes.size} routes -> data-raw/kric-route-${label}.json`,
    );
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
