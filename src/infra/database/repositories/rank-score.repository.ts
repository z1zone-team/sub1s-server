import { Injectable } from '@nestjs/common';
import {
  IRankScoreRepository,
  RankScoreWithUser,
} from '../../../domain/ranking/ports/IRankScoreRepository';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RankScoreRepository implements IRankScoreRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findLeaderboard(
    periodType: string,
    periodKey: string,
  ): Promise<RankScoreWithUser[]> {
    return this.prisma.rankScore.findMany({
      where: {
        periodType,
        periodKey,
      },
      orderBy: [{ totalPoints: 'desc' }, { totalDistanceKm: 'desc' }],
      include: {
        user: true,
      },
    });
  }
}
