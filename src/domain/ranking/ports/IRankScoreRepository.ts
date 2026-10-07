import { RankScore, User } from '@prisma/client';

export type RankScoreWithUser = RankScore & {
  user: User | null;
};

export interface IRankScoreRepository {
  findLeaderboard(
    periodType: string,
    periodKey: string,
  ): Promise<RankScoreWithUser[]>;
}

export const RANK_SCORE_REPOSITORY = Symbol('RANK_SCORE_REPOSITORY');
