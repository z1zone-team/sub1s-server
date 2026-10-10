import { RankingVisibility } from '@prisma/client';

export interface UserProfileResponseDto {
  id: string;
  clerkId: string;
  name: string | null;
  nickname: string;
  profileImageUrl?: string | null;
  totalDistanceMeters: number;
  currentStreakDays: number;
  rankScore: number;
  rankingVisibility: RankingVisibility;
  createdAt: string;
}
