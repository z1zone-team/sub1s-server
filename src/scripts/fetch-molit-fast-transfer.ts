import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  buildFastTransferUrl,
  parseFastTransferResponse,
} from './lib/molit-fast-transfer';
import { RAW_DIR } from './lib/subway-common';

/**
 * 국토교통부 철도역 빠른 환승 정보(공공데이터포털 15151816)를 한 번 호출해서 data-raw에 저장한다.
 *   pnpm fetch:molit-fast-transfer            24시간 안에 받은 파일이 있으면 호출하지 않는다
 *   pnpm fetch:molit-fast-transfer -- --force 받은 파일이 있어도 다시 호출한다
 * 키는 PUBLIC_DATA_API_KEY(.env.local 또는 .env)에서 읽고 출력하지 않는다. 실패해도 다시 시도하지 않는다.
 * 활용신청 승인이 반영되기 전에는 401(등록되지 않은 인증키)이 나올 수 있다(1~2시간)
 */
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const OUT_FILE = join(RAW_DIR, 'molit-fast-transfer.json');

async function main(): Promise<void> {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) process.loadEnvFile?.(file);
  }
  const key = process.env.PUBLIC_DATA_API_KEY;
  if (!key) throw new Error('PUBLIC_DATA_API_KEY is not set in .env.local or .env');

  const force = process.argv.includes('--force');
  if (!force && existsSync(OUT_FILE) && Date.now() - statSync(OUT_FILE).mtimeMs < MIN_INTERVAL_MS) {
    console.log(`[Fast Transfer] cached (< 24h), skipped: ${OUT_FILE}`);
    return;
  }

  const res = await fetch(buildFastTransferUrl(key));
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: response is not JSON`);
  }
  if (!res.ok) {
    const msg = (body as { msg?: string }).msg ?? '';
    throw new Error(`HTTP ${res.status} ${msg}`.trim());
  }

  const parsed = parseFastTransferResponse(body);
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  console.log(`[Fast Transfer] ${parsed.data.length} rows saved to ${OUT_FILE}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[Fast Transfer] Fatal error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
