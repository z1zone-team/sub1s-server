import { Injectable } from '@nestjs/common';
import { ISettlementLogRepository } from '../../../domain/notification/ports/notification-ports';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SettlementLogRepository implements ISettlementLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claim(userIds: string[], periodKey: string): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<{ user_id: string }[]>`
      INSERT INTO settlement_notifications (user_id, period_key, status)
      SELECT id, ${periodKey}, 'SENT'::settlement_status
      FROM unnest(${userIds}::uuid[]) AS id
      ON CONFLICT (user_id, period_key) DO NOTHING
      RETURNING user_id`;
    return rows.map((row) => row.user_id);
  }

  async markFailed(userIds: string[], periodKey: string): Promise<void> {
    if (userIds.length === 0) return;
    await this.prisma.settlementNotification.updateMany({
      where: { periodKey, userId: { in: userIds } },
      data: { status: 'FAILED' },
    });
  }
}
