import { User } from '@prisma/client';

export interface FriendRecord {
  user: User;
  friendedAt: Date;
}

export interface IFriendRepository {
  /** 토큰이 없으면 만들어 저장하고, 있으면 그대로 돌려준다 */
  getOrCreateInviteToken(userId: string): Promise<string>;
  /** 새 토큰으로 바꾸고 이전 토큰은 무효가 된다 */
  resetInviteToken(userId: string): Promise<string>;
  findUserByInviteToken(token: string): Promise<User | null>;
  /** 이미 친구면 false. 두 방향을 한 번에 저장한다 */
  addFriendship(userId: string, friendId: string): Promise<boolean>;
  /** 친구가 아니었으면 false */
  removeFriendship(userId: string, friendId: string): Promise<boolean>;
  findFriend(userId: string, friendId: string): Promise<FriendRecord | null>;
  /** 최근에 친구가 된 순서 */
  listFriends(userId: string): Promise<FriendRecord[]>;
  findFriendIds(userId: string): Promise<string[]>;
}

export const FRIEND_REPOSITORY = Symbol('FRIEND_REPOSITORY');
