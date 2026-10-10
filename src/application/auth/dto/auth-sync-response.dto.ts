import { RankingVisibility } from '@prisma/client';

export interface AuthSyncResponseDto {
  userId: string;
  clerkId: string;
  name: string | null;
  nickname: string;
  profileImageUrl?: string;
  rankingVisibility: RankingVisibility;
}
