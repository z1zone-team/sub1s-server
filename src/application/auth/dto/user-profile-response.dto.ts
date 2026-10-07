export interface UserProfileResponseDto {
  id: string;
  clerkId: string;
  nickname: string;
  profileImageUrl?: string | null;
  totalDistanceMeters: number;
  currentStreakDays: number;
  rankScore: number;
  isRankingPublic: boolean;
  createdAt: string;
}
