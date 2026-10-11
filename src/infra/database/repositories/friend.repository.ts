import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import {
  MAX_INVITE_TOKEN_ATTEMPTS,
  generateInviteToken,
} from '../../../domain/friend/models/invite-token';
import {
  FriendRecord,
  IFriendRepository,
} from '../../../domain/friend/ports/IFriendRepository';
import { PrismaService } from '../../prisma/prisma.service';

function isTokenCollision(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    String(error.meta?.target ?? '').includes('invite_token')
  );
}

@Injectable()
export class FriendRepository implements IFriendRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateInviteToken(userId: string): Promise<string> {
    const current = await this.readToken(userId);
    if (current) return current;

    await this.withFreshToken((inviteToken) =>
      this.prisma.user.updateMany({
        where: { id: userId, inviteToken: null },
        data: { inviteToken },
      }),
    );
    return (await this.readToken(userId)) as string;
  }

  async resetInviteToken(userId: string): Promise<string> {
    await this.withFreshToken((inviteToken) =>
      this.prisma.user.update({ where: { id: userId }, data: { inviteToken } }),
    );
    return (await this.readToken(userId)) as string;
  }

  async findUserByInviteToken(token: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { inviteToken: token } });
  }

  async addFriendship(userId: string, friendId: string): Promise<boolean> {
    const result = await this.prisma.friendship.createMany({
      data: [
        { userId, friendId },
        { userId: friendId, friendId: userId },
      ],
      skipDuplicates: true,
    });
    return result.count > 0;
  }

  async removeFriendship(userId: string, friendId: string): Promise<boolean> {
    const result = await this.prisma.friendship.deleteMany({
      where: {
        OR: [
          { userId, friendId },
          { userId: friendId, friendId: userId },
        ],
      },
    });
    return result.count > 0;
  }

  async findFriend(
    userId: string,
    friendId: string,
  ): Promise<FriendRecord | null> {
    const row = await this.prisma.friendship.findUnique({
      where: { userId_friendId: { userId, friendId } },
      include: { friend: true },
    });
    return row ? { user: row.friend, friendedAt: row.createdAt } : null;
  }

  async listFriends(userId: string): Promise<FriendRecord[]> {
    const rows = await this.prisma.friendship.findMany({
      where: { userId },
      include: { friend: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({ user: row.friend, friendedAt: row.createdAt }));
  }

  async findFriendIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.friendship.findMany({
      where: { userId },
      select: { friendId: true },
    });
    return rows.map((row) => row.friendId);
  }

  private async readToken(userId: string): Promise<string | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { inviteToken: true },
    });
    return row?.inviteToken ?? null;
  }

  private async withFreshToken<T>(
    attemptWith: (token: string) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await attemptWith(generateInviteToken());
      } catch (error) {
        if (!isTokenCollision(error) || attempt >= MAX_INVITE_TOKEN_ATTEMPTS) {
          throw error;
        }
      }
    }
  }
}
