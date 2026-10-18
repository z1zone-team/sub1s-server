import { Injectable } from '@nestjs/common';
import { ISettlementLogRepository } from '../../../domain/notification/ports/notification-ports';
import { PrismaService } from '../../prisma/prisma.service';

/** 한 사용자의 한 달 정산을 시도하는 최대 횟수 */
const MAX_ATTEMPTS = 3;
/** PROCESSING으로 이 시간 넘게 멈춰 있으면 프로세스가 죽은 것으로 보고 다시 시도한다 */
const LEASE_MINUTES = 30;

@Injectable()
export class SettlementLogRepository implements ISettlementLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claim(userIds: string[], periodKey: string): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<{ user_id: string }[]>`
      INSERT INTO settlement_notifications (user_id, period_key, status)
      SELECT id, ${periodKey}, 'PROCESSING'::settlement_status
      FROM unnest(${userIds}::uuid[]) AS id
      ON CONFLICT (user_id, period_key) DO UPDATE
        SET status = 'PROCESSING'::settlement_status,
            attempts = settlement_notifications.attempts + 1,
            updated_at = now()
        WHERE settlement_notifications.attempts < ${MAX_ATTEMPTS}::int
          AND (
            settlement_notifications.status = 'FAILED'::settlement_status
            OR (
              settlement_notifications.status = 'PROCESSING'::settlement_status
              AND settlement_notifications.updated_at < now() - make_interval(mins => ${LEASE_MINUTES}::int)
            )
          )
      RETURNING user_id`;
    return rows.map((row) => row.user_id);
  }

  async markSent(userIds: string[], periodKey: string): Promise<void> {
    await this.mark(userIds, periodKey, 'SENT');
  }

  async markFailed(userIds: string[], periodKey: string): Promise<void> {
    await this.mark(userIds, periodKey, 'FAILED');
  }

  private async mark(
    userIds: string[],
    periodKey: string,
    status: 'SENT' | 'FAILED',
  ): Promise<void> {
    if (userIds.length === 0) return;
    await this.prisma.settlementNotification.updateMany({
      where: { periodKey, userId: { in: userIds } },
      data: { status, updatedAt: new Date() },
    });
  }
}
