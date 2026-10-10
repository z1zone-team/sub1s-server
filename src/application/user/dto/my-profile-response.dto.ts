import { RankingVisibility } from '@prisma/client';

export interface MyProfileResponseDto {
  userId: string;
  name: string | null;
  nickname: string;
  profileImageUrl: string | null;
  rankingVisibility: RankingVisibility;
}
