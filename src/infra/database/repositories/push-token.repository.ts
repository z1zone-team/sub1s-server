import { Injectable } from '@nestjs/common';
import { MAX_TOKENS_PER_USER, StoredPushToken } from '../../../domain/notification/models/push';
import {
  IPushTokenRepository,
  RegisterPushToken,
} from '../../../domain/notification/ports/notification-ports';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PushTokenRepository implements IPushTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async register(data: RegisterPushToken): Promise<void> {
    const platform = data.platform ?? null;
    await this.prisma.pushToken.upsert({
      where: { token: data.token },
      create: { userId: data.userId, token: data.token, provider: data.provider, platform },
      update: { userId: data.userId, provider: data.provider, platform },
    });
    await this.trimOldTokens(data.userId);
  }

  async remove(userId: string, token: string): Promise<boolean> {
    const result = await this.prisma.pushToken.deleteMany({ where: { userId, token } });
    return result.count > 0;
  }

  async findByUserIds(userIds: string[]): Promise<Map<string, StoredPushToken[]>> {
    const rows = await this.prisma.pushToken.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, token: true, provider: true },
    });
    const result = new Map<string, StoredPushToken[]>();
    for (const row of rows) {
      const list = result.get(row.userId) ?? [];
      list.push({ token: row.token, provider: row.provider });
      result.set(row.userId, list);
    }
    return result;
  }

  async deleteTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.prisma.pushToken.deleteMany({ where: { token: { in: tokens } } });
  }

  // 기기를 바꾸며 쌓인 오래된 토큰은 가장 오래 쓰지 않은 것부터 지운다
  private async trimOldTokens(userId: string): Promise<void> {
    const stale = await this.prisma.pushToken.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      skip: MAX_TOKENS_PER_USER,
      select: { id: true },
    });
    if (stale.length === 0) return;
    await this.prisma.pushToken.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
  }
}
