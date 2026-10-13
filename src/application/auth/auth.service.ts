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
import {
  isSameNickname,
  sanitizeNickname,
} from '../../domain/user/models/nickname';

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
    // 앱이 보내는 이름(인증 서비스의 이름)은 닉네임 규칙을 모르므로 규칙에 맞게 다듬는다
    const syncedNickname = sanitizeNickname(dto?.nickname);

    if (!user) {
      user = await this.userRepo.upsertByClerkId({
        clerkId: authUser.clerkId,
        nickname: syncedNickname || authUser.nickname,
        profileImageUrl: dto?.profileImageUrl || authUser.profileImageUrl || null,
      });
    } else {
      if (
        syncedNickname &&
        !user.nicknameCustomized &&
        !isSameNickname(syncedNickname, user.nickname)
      ) {
        user = await this.userRepo.syncNickname(user.id, syncedNickname);
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
