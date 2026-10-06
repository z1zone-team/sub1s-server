export interface LeaderboardItemDto {
  rank: number;
  userId: string;
  nickname: string;
  profileImageUrl?: string;
  totalPoints: number;
  totalDistanceKm: number;
}

export interface RankingResponseDto {
  periodType: 'MONTHLY' | 'ALL';
  periodKey: string;
  friendsOnly: boolean;
  myRank: number;
  myPoints: number;
  leaderboard: LeaderboardItemDto[];
}
