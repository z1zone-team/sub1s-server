import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthUser } from '../../infra/auth/current-user.decorator';
import { AuthSyncRequestDto } from './dto/auth-sync-request.dto';
import { AuthSyncResponseDto } from './dto/auth-sync-response.dto';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async syncUser(
    authUser: AuthUser,
    dto?: AuthSyncRequestDto,
  ): Promise<AuthSyncResponseDto> {
    const updateData: { nickname?: string; profileImageUrl?: string } = {};

    if (dto?.nickname) {
      updateData.nickname = dto.nickname;
    }
    if (dto?.profileImageUrl) {
      updateData.profileImageUrl = dto.profileImageUrl;
    }

    let user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          id: authUser.id,
          clerkId: authUser.clerkId,
          nickname: dto?.nickname || authUser.nickname,
          profileImageUrl: dto?.profileImageUrl || authUser.profileImageUrl || null,
        },
      });
    } else if (Object.keys(updateData).length > 0) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });
    }

    return {
      userId: user.id,
      clerkId: user.clerkId,
      nickname: user.nickname,
      profileImageUrl: user.profileImageUrl ?? undefined,
      isRankingPublic: user.isRankingPublic,
    };
  }

  async getMe(authUser: AuthUser): Promise<UserProfileResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      include: {
        rankScores: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    const latestRankScore = user.rankScores?.[0];

    return {
      id: user.id,
      clerkId: user.clerkId,
      nickname: user.nickname,
      profileImageUrl: user.profileImageUrl,
      totalDistanceMeters: Math.round((latestRankScore?.totalDistanceKm ?? 0) * 1000),
      currentStreakDays: 0,
      rankScore: latestRankScore?.totalPoints ?? 0,
      isRankingPublic: user.isRankingPublic,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
