import { travelLogAad } from '../../domain/travel/ports/IPayloadEncryptor';
import { CryptoService } from '../../infra/security/crypto.service';

/** 이 스크립트가 쓰는 DB 접근. Prisma 클라이언트가 이 모양을 만족한다 */
export interface TravelLogRows {
  travelLog: {
    findMany(args: {
      where: { encryptedRoutePayload: { not: null }; id?: { gt: string } };
      orderBy: { id: 'asc' };
      take: number;
      select: {
        id: true;
        userId: true;
        encryptedRoutePayload: true;
        iv: true;
        authTag: true;
        wrappedDek: true;
      };
    }): Promise<
      Array<{
        id: string;
        userId: string;
        encryptedRoutePayload: string | null;
        iv: string | null;
        authTag: string | null;
        wrappedDek: string | null;
      }>
    >;
    update(args: {
      where: { id: string };
      data: {
        encryptedRoutePayload: string;
        iv: string;
        authTag: string;
        wrappedDek: string;
      };
    }): Promise<unknown>;
  };
}

export interface ReencryptReport {
  scanned: number;
  alreadyCurrent: number;
  migrated: number;
  failed: Array<{ id: string; reason: string }>;
}

/**
 * 이동 기록의 암호문을 현재 키와 현재 형식(키 ID, 소유자 묶기)으로 다시 쓴다.
 * 키를 교체한 뒤 이전 키를 설정에서 빼기 전에 돌린다. `apply`가 아니면 아무것도 쓰지 않고 센다.
 * 풀리지 않는 행은 건드리지 않고 목록에 남긴다
 */
export async function reencryptTravelLogs(
  prisma: TravelLogRows,
  crypto: CryptoService,
  options: { apply: boolean; batchSize?: number },
): Promise<ReencryptReport> {
  const batchSize = options.batchSize ?? 200;
  const report: ReencryptReport = {
    scanned: 0,
    alreadyCurrent: 0,
    migrated: 0,
    failed: [],
  };

  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.travelLog.findMany({
      where: {
        encryptedRoutePayload: { not: null },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        userId: true,
        encryptedRoutePayload: true,
        iv: true,
        authTag: true,
        wrappedDek: true,
      },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      report.scanned += 1;
      if (
        !row.encryptedRoutePayload ||
        !row.iv ||
        !row.authTag ||
        !row.wrappedDek
      ) {
        report.failed.push({ id: row.id, reason: '암호문 필드가 비어 있어요' });
        continue;
      }
      const bundle = {
        ciphertext: row.encryptedRoutePayload,
        iv: row.iv,
        tag: row.authTag,
        wrappedDek: row.wrappedDek,
      };
      try {
        const aad = travelLogAad(row.userId);
        const plaintext = crypto.decrypt(bundle, aad);
        if (crypto.isCurrent(bundle)) {
          report.alreadyCurrent += 1;
          continue;
        }
        if (options.apply) {
          const next = crypto.encrypt(plaintext, aad);
          await prisma.travelLog.update({
            where: { id: row.id },
            data: {
              encryptedRoutePayload: next.ciphertext,
              iv: next.iv,
              authTag: next.tag,
              wrappedDek: next.wrappedDek,
            },
          });
        }
        report.migrated += 1;
      } catch (error) {
        report.failed.push({
          id: row.id,
          reason: error instanceof Error ? error.message : '알 수 없는 오류',
        });
      }
    }
  }
  return report;
}
