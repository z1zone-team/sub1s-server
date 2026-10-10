import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../domain/user/ports/IUserRepository';
import { AuthUser } from '../../infra/auth/current-user.decorator';
import { AuthSyncRequestDto } from './dto/auth-sync-request.dto';
import { AuthSyncResponseDto } from './dto/auth-sync-response.dto';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
import { toKstIso } from '../../common/utils/kst';
import { isSameNickname } from '../../domain/user/models/nickname';

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
  ) {}

  async syncUser(
    authUser: AuthUser,
    dto?: AuthSyncRequestDto,
  ): Promise<AuthSyncResponseDto> {
    let user = await this.userRepo.findById(authUser.id);

    if (!user) {
      user = await this.userRepo.upsertByClerkId({
        clerkId: authUser.clerkId,
        nickname: dto?.nickname || authUser.nickname,
        profileImageUrl: dto?.profileImageUrl || authUser.profileImageUrl || null,
      });
    } else {
      if (
        dto?.nickname &&
        !user.nicknameCustomized &&
        !isSameNickname(dto.nickname, user.nickname)
      ) {
        user = await this.userRepo.syncNickname(user.id, dto.nickname);
      }
      if (dto?.profileImageUrl) {
        user = await this.userRepo.updateUser(user.id, {
          profileImageUrl: dto.profileImageUrl,
        });
      }
    }

    return {
      userId: user.id,
      clerkId: user.clerkId,
      name: user.name,
      nickname: user.nickname,
      profileImageUrl: user.profileImageUrl ?? undefined,
      rankingVisibility: user.rankingVisibility,
    };
  }

  async getMe(authUser: AuthUser): Promise<UserProfileResponseDto> {
    const user = await this.userRepo.findByIdWithLatestRank(authUser.id);

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    const latestRankScore = user.rankScores?.[0];

    return {
      id: user.id,
      clerkId: user.clerkId,
      name: user.name,
      nickname: user.nickname,
      profileImageUrl: user.profileImageUrl,
      totalDistanceMeters: Math.round((latestRankScore?.totalDistanceKm ?? 0) * 1000),
      currentStreakDays: 0,
      rankScore: latestRankScore?.totalPoints ?? 0,
      rankingVisibility: user.rankingVisibility,
      createdAt: toKstIso(user.createdAt),
    };
  }
}
