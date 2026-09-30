import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const PAGE_SIZE = 1000;
const OUT_DIR = join(__dirname, '../../data-raw');

const DATASETS = [
  { service: 'SearchSTNBySubwayLineInfo', file: 'seoul-stations-by-line.json' },
  { service: 'StationDstncReqreTimeHm', file: 'seoul-station-distance-time.json' },
  { service: 'subwayTrans', file: 'seoul-transfer.json' },
  { service: 'subwayStationMaster', file: 'seoul-station-master.json' },
] as const;

interface ServiceBody {
  list_total_count: number;
  RESULT: { CODE: string; MESSAGE: string };
  row: unknown[];
}

function isServiceBody(value: unknown): value is ServiceBody {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body.list_total_count === 'number' && Array.isArray(body.row);
}

async function fetchPage(key: string, service: string, start: number, end: number): Promise<ServiceBody> {
  const res = await fetch(`http://openapi.seoul.go.kr:8088/${key}/json/${service}/${start}/${end}/`);
  if (!res.ok) throw new Error(`${service}: HTTP ${res.status}`);
  const json: unknown = await res.json();
  const body = typeof json === 'object' && json !== null ? (json as Record<string, unknown>)[service] : undefined;
  if (!isServiceBody(body)) {
    const result = typeof json === 'object' && json !== null ? (json as Record<string, unknown>).RESULT : undefined;
    throw new Error(`${service}: unexpected response ${JSON.stringify(result)}`);
  }
  return body;
}

async function main(): Promise<void> {
  process.loadEnvFile?.('.env');
  const key = process.env.SEOUL_OPEN_API_KEY;
  if (!key) throw new Error('SEOUL_OPEN_API_KEY is not set in .env');

  mkdirSync(OUT_DIR, { recursive: true });

  for (const { service, file } of DATASETS) {
    const rows: unknown[] = [];
    let total = Infinity;
    for (let start = 1; start <= total; start += PAGE_SIZE) {
      const body = await fetchPage(key, service, start, start + PAGE_SIZE - 1);
      total = body.list_total_count;
      rows.push(...body.row);
    }
    writeFileSync(join(OUT_DIR, file), JSON.stringify(rows, null, 2));
    console.log(`${service}: ${rows.length}/${total} rows -> data-raw/${file}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
