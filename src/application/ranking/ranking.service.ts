import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LeaderboardItemDto, RankingQueryDto, RankingResponseDto } from './dto';

@Injectable()
export class RankingService {
  constructor(private readonly prisma: PrismaService) {}

  async getRanking(
    userId: string,
    query: RankingQueryDto,
  ): Promise<RankingResponseDto> {
    const scores = await this.prisma.rankScore.findMany({
      where: {
        periodType: query.periodType,
        periodKey: query.periodKey,
      },
      orderBy: [{ totalPoints: 'desc' }, { totalDistanceKm: 'desc' }],
      include: {
        user: true,
      },
    });

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

    return {
      periodType: query.periodType,
      periodKey: query.periodKey,
      friendsOnly: query.friendsOnly ?? false,
      myRank,
      myPoints,
      leaderboard,
    };
  }
}
