import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import {
  IUserRepository,
  UpsertClerkUserData,
  UserWithLatestRank,
} from '../../../domain/user/ports/IUserRepository';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findByIdWithLatestRank(id: string): Promise<UserWithLatestRank | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        rankScores: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async findByClerkId(clerkId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { clerkId },
    });
  }

  async upsertByClerkId(data: UpsertClerkUserData): Promise<User> {
    const updateData: { nickname?: string; profileImageUrl?: string | null } = {};
    if (data.nickname !== undefined) updateData.nickname = data.nickname;
    if (data.profileImageUrl !== undefined) updateData.profileImageUrl = data.profileImageUrl;

    return this.prisma.user.upsert({
      where: { clerkId: data.clerkId },
      update: updateData,
      create: {
        clerkId: data.clerkId,
        nickname: data.nickname || `탐험가_${data.clerkId.slice(-6)}`,
        profileImageUrl: data.profileImageUrl ?? null,
        isRankingPublic: true,
      },
    });
  }

  async updateUser(
    id: string,
    data: { nickname?: string; profileImageUrl?: string | null },
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async upsertPlaceholder(id: string, nickname = '테스트유저'): Promise<User> {
    return this.prisma.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        clerkId: `clerk_${id}`,
        nickname,
      },
    });
  }
}
