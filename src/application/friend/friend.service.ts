import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { toKstIso } from '../../common/utils/kst';
import {
  FRIEND_REPOSITORY,
  FriendRecord,
  IFriendRepository,
} from '../../domain/friend/ports/IFriendRepository';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../domain/user/ports/IUserRepository';
import {
  FriendDto,
  FriendListResponseDto,
  InviteTokenResponseDto,
  RemoveFriendResponseDto,
} from './dto/friend.dto';

@Injectable()
export class FriendService {
  constructor(
    @Inject(FRIEND_REPOSITORY)
    private readonly friendRepo: IFriendRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
  ) {}

  async listFriends(userId: string): Promise<FriendListResponseDto> {
    await this.requireUser(userId);
    const records = await this.friendRepo.listFriends(userId);
    return {
      totalCount: records.length,
      friends: records.map((record) => this.toDto(record)),
    };
  }

  async getInviteToken(userId: string): Promise<InviteTokenResponseDto> {
    await this.requireUser(userId);
    return { inviteToken: await this.friendRepo.getOrCreateInviteToken(userId) };
  }

  async resetInviteToken(userId: string): Promise<InviteTokenResponseDto> {
    await this.requireUser(userId);
    return { inviteToken: await this.friendRepo.resetInviteToken(userId) };
  }

  async acceptInvite(userId: string, inviteToken: string): Promise<FriendDto> {
    await this.requireUser(userId);

    const inviter = await this.friendRepo.findUserByInviteToken(inviteToken);
    if (!inviter) {
      throw new BusinessException(
        'INVITE_NOT_FOUND',
        'invite link is invalid or has been reset',
        HttpStatus.NOT_FOUND,
      );
    }
    if (inviter.id === userId) {
      throw new BusinessException(
        'SELF_INVITE',
        'you cannot accept your own invite link',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.friendRepo.addFriendship(userId, inviter.id);
    const record = await this.friendRepo.findFriend(userId, inviter.id);
    return this.toDto(record as FriendRecord);
  }

  async removeFriend(
    userId: string,
    friendId: string,
  ): Promise<RemoveFriendResponseDto> {
    if (!(await this.friendRepo.removeFriendship(userId, friendId))) {
      throw new BusinessException(
        'FRIEND_NOT_FOUND',
        'not a friend',
        HttpStatus.NOT_FOUND,
      );
    }
    return { friendId };
  }

  private toDto({ user, friendedAt }: FriendRecord): FriendDto {
    return {
      userId: user.id,
      nickname: user.nickname,
      profileImageUrl: user.profileImageUrl,
      friendedAt: toKstIso(friendedAt),
    };
  }

  private async requireUser(userId: string): Promise<void> {
    if (!(await this.userRepo.findById(userId))) {
      throw new BusinessException(
        'USER_NOT_FOUND',
        'user not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
