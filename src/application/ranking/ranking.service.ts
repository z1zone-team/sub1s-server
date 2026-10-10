import { Inject, Injectable } from '@nestjs/common';
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
  ) {}

  async getRanking(
    userId: string,
    query: RankingQueryDto,
  ): Promise<RankingResponseDto> {
    const scores = await this.rankScoreRepo.findLeaderboard(
      query.periodType,
      query.periodKey,
    );

    const visible = scores.filter(
      (item) =>
        item.userId === userId || item.user?.rankingVisibility !== 'PRIVATE',
    );

    let myRank = 0;
    let myPoints = 0;

    const allRanked: LeaderboardItemDto[] = visible.map((item, index) => {
      const rank = index + 1;
      const isMe = item.userId === userId;
      if (isMe) {
        myRank = rank;
        myPoints = item.totalPoints;
      }

      const base = {
        rank,
        totalPoints: item.totalPoints,
        totalDistanceKm: Math.round(item.totalDistanceKm * 10) / 10,
        isMe,
      };

      if (!isMe && item.user?.rankingVisibility === 'ANONYMOUS') {
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

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const startIndex = (page - 1) * limit;
    const leaderboard = allRanked.slice(startIndex, startIndex + limit);

    // 부동소수점 오차로 12%가 13%로 올림되지 않도록 정수로 계산
    const totalUsers = allRanked.length;
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
