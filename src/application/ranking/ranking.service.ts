import { Inject, Injectable } from '@nestjs/common';
import {
  FRIEND_REPOSITORY,
  IFriendRepository,
} from '../../domain/friend/ports/IFriendRepository';
import {
  IRankScoreRepository,
  RANK_SCORE_REPOSITORY,
} from '../../domain/ranking/ports/IRankScoreRepository';
import { LeaderboardItemDto, RankingQueryDto, RankingResponseDto } from './dto';

const ANONYMOUS_NICKNAME = '익명';

@Injectable()
export class RankingService {
  constructor(
    @Inject(RANK_SCORE_REPOSITORY)
    private readonly rankScoreRepo: IRankScoreRepository,
    @Inject(FRIEND_REPOSITORY)
    private readonly friendRepo: IFriendRepository,
  ) {}

  async getRanking(
    userId: string,
    query: RankingQueryDto,
  ): Promise<RankingResponseDto> {
    const friendIds = query.friendsOnly
      ? await this.friendRepo.findFriendIds(userId)
      : undefined;
    const friendSet = friendIds ? new Set(friendIds) : undefined;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const startIndex = (page - 1) * limit;
    const { items, total, mine } =
      await this.rankScoreRepo.findVisibleRankingPage({
        periodType: query.periodType,
        periodKey: query.periodKey,
        viewerId: userId,
        friendIds,
        offset: startIndex,
        limit,
      });

    const leaderboard: LeaderboardItemDto[] = items.map((item, index) => {
      const isMe = item.userId === userId;
      const base = {
        rank: startIndex + index + 1,
        totalPoints: item.totalPoints,
        totalDistanceKm: Math.round(item.totalDistanceKm * 10) / 10,
        isMe,
      };

      const isFriend = friendSet?.has(item.userId) ?? false;
      if (!isMe && !isFriend && item.user?.rankingVisibility === 'ANONYMOUS') {
        return { ...base, nickname: ANONYMOUS_NICKNAME, isAnonymous: true };
      }
      return {
        ...base,
        userId: item.userId,
        nickname: item.user?.nickname ?? '알 수 없음',
        profileImageUrl: item.user?.profileImageUrl ?? undefined,
        isAnonymous: false,
      };
    });

    const myRank = mine?.rank ?? 0;
    const myPoints = mine?.points ?? 0;

    // 부동소수점 오차로 12%가 13%로 올림되지 않도록 정수로 계산
    const totalUsers = total;
    const myPercentile =
      myRank > 0 ? Math.ceil((myRank * 100) / totalUsers) : undefined;

    return {
      periodType: query.periodType,
      periodKey: query.periodKey,
      friendsOnly: query.friendsOnly ?? false,
      myRank,
      myPoints,
      totalUsers,
      myPercentile,
      leaderboard,
    };
  }
}
