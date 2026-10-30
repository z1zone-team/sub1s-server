import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import {
  TransferMovementPath,
  TransferMovementRequest,
  cacheFileName,
  parseArgs,
  requestsFromArgs,
  resultCodeOf,
  summarizeTransferMovement,
} from './lib/kric-transfer-movement';
import { RAW_DIR } from './lib/subway-common';

const BASE_URL =
  'https://openapi.kric.go.kr/openapi/vulnerableUserInfo/transferMovement';
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // KRIC 권고: 하루 1회
const REQUEST_GAP_MS = 100;
const CACHE_DIR = join(RAW_DIR, 'kric-transfer-movement');
const SUMMARY_PATH = join(RAW_DIR, 'kric-transfer-movement.json');

interface SummaryEntry {
  request: TransferMovementRequest;
  resultCode?: string;
  paths: TransferMovementPath[];
}

function loadKey(): string {
  for (const file of ['.env', '.env.local']) {
    try {
      process.loadEnvFile?.(file);
    } catch {
      // 없는 파일은 건너뛴다
    }
  }
  const key = process.env.KRIC_API_KEY;
  if (!key) throw new Error('KRIC_API_KEY is not set in .env or .env.local');
  return key;
}

async function fetchFromKric(
  key: string,
  request: TransferMovementRequest,
): Promise<string> {
  const qs = new URLSearchParams({
    serviceKey: key,
    format: 'json',
    ...request,
  });
  const res = await fetch(`${BASE_URL}?${qs.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function isFresh(path: string): boolean {
  return (
    existsSync(path) && Date.now() - statSync(path).mtimeMs < MIN_INTERVAL_MS
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fileRequests =
    args.file !== undefined
      ? (JSON.parse(readFileSync(args.file, 'utf8')) as unknown[])
      : [];
  const requests = requestsFromArgs(args, fileRequests);

  const plan = requests.map((request) => {
    const cachePath = join(CACHE_DIR, cacheFileName(request));
    return { request, cachePath, cached: !args.force && isFresh(cachePath) };
  });
  const toFetch = plan.filter((item) => !item.cached).length;
  console.log(
    `[KRIC transferMovement] requests: ${plan.length}, cached: ${plan.length - toFetch}, to fetch: ${toFetch}${args.dryRun ? ' (dry-run)' : ''}`,
  );
  if (args.dryRun) {
    for (const item of plan) {
      console.log(
        `${item.cached ? 'cached ' : 'fetch  '} ${cacheFileName(item.request)}`,
      );
    }
    return;
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const key = toFetch > 0 ? loadKey() : '';
  const summary: Record<string, SummaryEntry> = existsSync(SUMMARY_PATH)
    ? (JSON.parse(readFileSync(SUMMARY_PATH, 'utf8')) as Record<
        string,
        SummaryEntry
      >)
    : {};

  let errors = 0;
  for (const { request, cachePath, cached } of plan) {
    let json: unknown;
    try {
      if (cached) {
        json = JSON.parse(readFileSync(cachePath, 'utf8'));
      } else {
        const body = (await fetchFromKric(key, request)).split(key).join('***');
        json = JSON.parse(body);
        writeFileSync(cachePath, JSON.stringify(json, null, 2));
        await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
      }
    } catch (err) {
      errors += 1;
      console.error(
        `Failed ${cacheFileName(request)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    summary[cacheFileName(request).replace(/\.json$/, '')] = {
      request,
      resultCode: resultCodeOf(json),
      paths: summarizeTransferMovement(json),
    };
  }

  writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2) + '\n');
  console.log(
    `finished: ${Object.keys(summary).length} records in kric-transfer-movement.json, errors: ${errors}`,
  );
  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
