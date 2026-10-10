export interface LeaderboardItemDto {
  rank: number;
  /** 익명 사용자는 없음 */
  userId?: string;
  nickname: string;
  profileImageUrl?: string;
  totalPoints: number;
  totalDistanceKm: number;
  isMe: boolean;
  isAnonymous: boolean;
}

export interface RankingResponseDto {
  periodType: 'MONTHLY' | 'ALL';
  periodKey: string;
  friendsOnly: boolean;
  myRank: number;
  myPoints: number;
  /** 해당 기간에 점수가 있는 사용자 수 */
  totalUsers: number;
  /** 상위 몇 %인지 (작을수록 상위, 1~100). 해당 기간에 점수가 없으면 없음 */
  myPercentile?: number;
  leaderboard: LeaderboardItemDto[];
}
