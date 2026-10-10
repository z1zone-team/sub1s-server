import { Inject, Injectable } from '@nestjs/common';
import {
  IRankScoreRepository,
  RANK_SCORE_REPOSITORY,
} from '../../domain/ranking/ports/IRankScoreRepository';
import { LeaderboardItemDto, RankingQueryDto, RankingResponseDto } from './dto';

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

    let myRank = 0;
    let myPoints = 0;

    const allRanked: LeaderboardItemDto[] = scores.map((item, index) => {
      const rank = index + 1;
      if (item.userId === userId) {
        myRank = rank;
        myPoints = item.totalPoints;
      }

      return {
        rank,
        userId: item.userId,
        nickname: item.user?.nickname ?? '알 수 없음',
        profileImageUrl: item.user?.profileImageUrl ?? undefined,
        totalPoints: item.totalPoints,
        totalDistanceKm: Math.round(item.totalDistanceKm * 10) / 10,
      };
    });

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const startIndex = (page - 1) * limit;
    const leaderboard = allRanked.slice(startIndex, startIndex + limit);

    // Integer math so 12 of 100 is exactly 12, not 12.000000000000002 rounded up to 13.
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
