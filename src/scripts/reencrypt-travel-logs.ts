import { PrismaClient } from '@prisma/client';
import { CryptoService } from '../infra/security/crypto.service';
import { reencryptTravelLogs } from './lib/reencrypt-travel-logs';

/**
 * 이동 기록 암호문을 현재 키와 현재 형식으로 다시 쓴다(키 교체 뒤 이전 키를 빼기 전에 돌린다).
 *
 *   ts-node src/scripts/reencrypt-travel-logs.ts            # 센다(아무것도 쓰지 않음)
 *   ts-node src/scripts/reencrypt-travel-logs.ts --apply    # 실제로 다시 쓴다
 *
 * 풀리지 않는 행은 건드리지 않고 ID와 사유만 출력한다(내용은 출력하지 않는다)
 */
async function main(): Promise<void> {
  try {
    process.loadEnvFile?.('.env');
  } catch {
    // .env가 없으면 이미 설정된 환경변수를 쓴다
  }
  const apply = process.argv.slice(2).includes('--apply');

  const prisma = new PrismaClient();
  try {
    const crypto = new CryptoService();
    console.log(
      `현재 키 ID: ${crypto.currentKeyId}, 모드: ${apply ? '실제로 다시 쓰기(--apply)' : '세기만 하기(dry-run)'}`,
    );
    const report = await reencryptTravelLogs(prisma, crypto, { apply });
    console.log(`확인한 행: ${report.scanned}`);
    console.log(`이미 현재 키와 형식: ${report.alreadyCurrent}`);
    console.log(`${apply ? '다시 쓴 행' : '다시 쓸 행'}: ${report.migrated}`);
    console.log(`풀지 못한 행: ${report.failed.length}`);
    for (const item of report.failed.slice(0, 50)) {
      console.log(`  - ${item.id}: ${item.reason}`);
    }
    if (report.failed.length > 50) {
      console.log(`  ... 외 ${report.failed.length - 50}개`);
    }
    process.exitCode = report.failed.length > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
