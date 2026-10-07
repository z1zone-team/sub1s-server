import { RankScore, User } from '@prisma/client';

export interface UpsertClerkUserData {
  clerkId: string;
  email?: string;
  nickname?: string;
  profileImageUrl?: string | null;
}

export type UserWithLatestRank = User & {
  rankScores?: RankScore[];
};

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByIdWithLatestRank(id: string): Promise<UserWithLatestRank | null>;
  findByClerkId(clerkId: string): Promise<User | null>;
  upsertByClerkId(data: UpsertClerkUserData): Promise<User>;
  updateUser(id: string, data: { nickname?: string; profileImageUrl?: string | null }): Promise<User>;
  upsertPlaceholder(id: string, nickname?: string): Promise<User>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
