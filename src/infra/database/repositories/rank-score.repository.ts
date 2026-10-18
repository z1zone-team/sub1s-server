import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IRankScoreRepository,
  RankScoreWithUser,
  VisibleRankingPage,
  VisibleRankingPageParams,
} from '../../../domain/ranking/ports/IRankScoreRepository';
import { PrismaService } from '../../prisma/prisma.service';

/** 점수와 거리가 같으면 사용자 ID로 가려 페이지를 넘겨도 순서가 바뀌지 않게 한다 */
const RANKING_ORDER: Prisma.RankScoreOrderByWithRelationInput[] = [
  { totalPoints: 'desc' },
  { totalDistanceKm: 'desc' },
  { userId: 'asc' },
];

@Injectable()
export class RankScoreRepository implements IRankScoreRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findVisibleRankingPage(
    params: VisibleRankingPageParams,
  ): Promise<VisibleRankingPage> {
    const { periodType, periodKey, viewerId, friendIds } = params;
    const visible: Prisma.RankScoreWhereInput = {
      periodType,
      periodKey,
      OR: [
        { userId: viewerId },
        {
          user: { rankingVisibility: { not: 'PRIVATE' } },
          ...(friendIds ? { userId: { in: friendIds } } : {}),
        },
      ],
    };

    const [items, total, mine] = await Promise.all([
      this.prisma.rankScore.findMany({
        where: visible,
        orderBy: RANKING_ORDER,
        skip: params.offset,
        take: params.limit,
        include: {
          user: {
            select: {
              nickname: true,
              profileImageUrl: true,
              rankingVisibility: true,
            },
          },
        },
      }),
      this.prisma.rankScore.count({ where: visible }),
      this.prisma.rankScore.findFirst({
        where: { periodType, periodKey, userId: viewerId },
        select: { totalPoints: true, totalDistanceKm: true },
      }),
    ]);

    if (!mine) return { items, total };
    const ahead = await this.prisma.rankScore.count({
      where: {
        AND: [
          visible,
          {
            OR: [
              { totalPoints: { gt: mine.totalPoints } },
              {
                totalPoints: mine.totalPoints,
                totalDistanceKm: { gt: mine.totalDistanceKm },
              },
              {
                totalPoints: mine.totalPoints,
                totalDistanceKm: mine.totalDistanceKm,
                userId: { lt: viewerId },
              },
            ],
          },
        ],
      },
    });
    return {
      items,
      total,
      mine: { rank: ahead + 1, points: mine.totalPoints },
    };
  }

  async findLeaderboard(
    periodType: string,
    periodKey: string,
  ): Promise<RankScoreWithUser[]> {
    return this.prisma.rankScore.findMany({
      where: {
        periodType,
        periodKey,
      },
      orderBy: RANKING_ORDER,
      include: {
        user: true,
      },
    });
  }
}
