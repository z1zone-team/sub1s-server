import { RankScore, User } from '@prisma/client';

export type RankScoreWithUser = RankScore & {
  user: User | null;
};

/** 랭킹 화면에 필요한 사용자 정보만 */
export type RankingUser = Pick<
  User,
  'nickname' | 'profileImageUrl' | 'rankingVisibility'
>;

export type RankScoreWithRankingUser = RankScore & {
  user: RankingUser | null;
};

export interface VisibleRankingPageParams {
  periodType: string;
  periodKey: string;
  /** 보는 사람. 비공개여도 본인은 항상 순위에 들어간다 */
  viewerId: string;
  /** 있으면 이 사용자들과 본인만 순위에 들어간다 */
  friendIds?: string[];
  offset: number;
  limit: number;
}

export interface VisibleRankingPage {
  items: RankScoreWithRankingUser[];
  /** 순위에 들어가는 사용자 수(비공개 제외) */
  total: number;
  /** 보는 사람의 순위와 점수. 이 기간에 점수가 없으면 없다 */
  mine?: { rank: number; points: number };
}

export interface IRankScoreRepository {
  /**
   * 점수, 거리, 사용자 ID 순으로 정렬한 순위의 한 쪽. 비공개 사용자는 빼고(본인은 포함) 순위를 매기며
   * 전체를 읽지 않고 DB에서 자르고 센다
   */
  findVisibleRankingPage(
    params: VisibleRankingPageParams,
  ): Promise<VisibleRankingPage>;
  findLeaderboard(
    periodType: string,
    periodKey: string,
  ): Promise<RankScoreWithUser[]>;
}

export const RANK_SCORE_REPOSITORY = Symbol('RANK_SCORE_REPOSITORY');
