import { RankScore, RankingVisibility, User } from '@prisma/client';

export interface UpsertClerkUserData {
  clerkId: string;
  email?: string;
  nickname?: string;
  profileImageUrl?: string | null;
}

export type UserWithLatestRank = User & {
  rankScores?: RankScore[];
};

export interface UpdateProfileData {
  /** null이면 이름을 지운다 */
  name?: string | null;
  nickname?: string;
  rankingVisibility?: RankingVisibility;
}

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByIdWithLatestRank(id: string): Promise<UserWithLatestRank | null>;
  findByClerkId(clerkId: string): Promise<User | null>;
  /** 닉네임은 새로 만들 때만 쓰고, 이미 쓰는 닉네임이면 접미사를 붙인다 */
  upsertByClerkId(data: UpsertClerkUserData): Promise<User>;
  updateUser(id: string, data: { profileImageUrl?: string | null }): Promise<User>;
  /** 다른 사용자가 쓰는 닉네임이면 NicknameTakenError. 닉네임을 바꾸면 사용자가 직접 정한 것으로 표시한다 */
  updateProfile(id: string, data: UpdateProfileData): Promise<User>;
  /** Clerk 프로필 닉네임 반영. 이미 쓰는 닉네임이면 접미사를 붙이고 직접 정한 것으로 표시하지 않는다 */
  syncNickname(id: string, nickname: string): Promise<User>;
  isNicknameTaken(nickname: string, exceptUserId?: string): Promise<boolean>;
  upsertPlaceholder(id: string, nickname?: string): Promise<User>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
