import { Injectable } from '@nestjs/common';
import {
  INotificationSettingsRepository,
  NotificationSettings,
} from '../../../domain/notification/ports/notification-ports';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationSettingsRepository implements INotificationSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<NotificationSettings> {
    const row = await this.prisma.userNotificationSetting.findUnique({
      where: { userId },
      select: { monthlySettlement: true },
    });
    return { monthlySettlement: row?.monthlySettlement ?? true };
  }

  async update(
    userId: string,
    patch: Partial<NotificationSettings>,
  ): Promise<NotificationSettings> {
    const row = await this.prisma.userNotificationSetting.upsert({
      where: { userId },
      create: { userId, ...patch },
      update: patch,
      select: { monthlySettlement: true },
    });
    return { monthlySettlement: row.monthlySettlement };
  }

  async findMonthlySettlementDisabled(userIds: string[]): Promise<Set<string>> {
    const rows = await this.prisma.userNotificationSetting.findMany({
      where: { userId: { in: userIds }, monthlySettlement: false },
      select: { userId: true },
    });
    return new Set(rows.map((row) => row.userId));
  }
}
