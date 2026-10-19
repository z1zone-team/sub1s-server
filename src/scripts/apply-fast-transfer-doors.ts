import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { MolitFastTransferResponse, applyFastTransferDoors } from './lib/molit-fast-transfer';
import { OUT_DIR, RAW_DIR, loadStations, readJson } from './lib/subway-common';
import { TransferRow } from './lib/transfers';

/**
 * 국토교통부 빠른 환승 정보(data-raw/molit-fast-transfer.json)의 문을 transfers.json의 recommendedDoors에 반영한다.
 * 새 자료가 있는 환승은 그 문으로 바꾸고, 없으면 기존 값(KRIC 계단 인접 문)을 그대로 둔다.
 * refine:transfers, supplement:transfers 뒤에 돌리고, 여러 번 돌려도 결과가 같다
 *   pnpm fetch:molit-fast-transfer && pnpm apply:fast-transfer-doors
 */
function main(): void {
  const rawPath = join(RAW_DIR, 'molit-fast-transfer.json');
  if (!existsSync(rawPath)) {
    throw new Error('molit-fast-transfer.json not found. Run pnpm fetch:molit-fast-transfer first.');
  }
  const rows = readJson<MolitFastTransferResponse>(rawPath).data;
  const lineNames = Object.fromEntries(
    readJson<{ id: string; lineName: string }[]>(join(OUT_DIR, 'lines.json')).map((line) => [line.id, line.lineName]),
  );

  const path = join(OUT_DIR, 'transfers.json');
  const { transfers, stats } = applyFastTransferDoors(
    readJson<TransferRow[]>(path),
    loadStations(),
    lineNames,
    rows,
  );
  writeFileSync(path, JSON.stringify(transfers, null, 2) + '\n');
  console.log(
    `[Fast Transfer] ${transfers.length} rows: ${stats.fromMolit} from the new data, ${stats.kept} kept, ${stats.empty} still empty`,
  );
}

main();
