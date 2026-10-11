import { HttpStatus } from '@nestjs/common';
import { IFriendRepository } from '../../domain/friend/ports/IFriendRepository';
import { IUserRepository } from '../../domain/user/ports/IUserRepository';
import { FriendService } from './friend.service';

describe('FriendService', () => {
  let friendRepo: jest.Mocked<IFriendRepository>;
  let userRepo: { findById: jest.Mock };
  let service: FriendService;

  const inviter = {
    id: 'inviter-1',
    nickname: '민서',
    profileImageUrl: 'https://img.test/a.png',
  };
  const friendedAt = new Date('2026-10-11T05:30:00Z');

  beforeEach(() => {
    friendRepo = {
      getOrCreateInviteToken: jest.fn().mockResolvedValue('token-abc-123'),
      resetInviteToken: jest.fn().mockResolvedValue('token-new-456'),
      findUserByInviteToken: jest.fn().mockResolvedValue(inviter),
      addFriendship: jest.fn().mockResolvedValue(true),
      removeFriendship: jest.fn().mockResolvedValue(true),
      findFriend: jest.fn().mockResolvedValue({ user: inviter, friendedAt }),
      listFriends: jest.fn().mockResolvedValue([{ user: inviter, friendedAt }]),
      findFriendIds: jest.fn(),
    } as unknown as jest.Mocked<IFriendRepository>;
    userRepo = { findById: jest.fn().mockResolvedValue({ id: 'me' }) };
    service = new FriendService(friendRepo, userRepo as unknown as IUserRepository);
  });

  it('lists friends with a KST timestamp and the total count', async () => {
    const res = await service.listFriends('me');

    expect(res).toEqual({
      totalCount: 1,
      friends: [
        {
          userId: 'inviter-1',
          nickname: '민서',
          profileImageUrl: 'https://img.test/a.png',
          friendedAt: '2026-10-11T14:30:00.000+09:00',
        },
      ],
    });
  });

  it('returns and resets the invite token', async () => {
    expect(await service.getInviteToken('me')).toEqual({ inviteToken: 'token-abc-123' });
    expect(await service.resetInviteToken('me')).toEqual({ inviteToken: 'token-new-456' });
  });

  describe('acceptInvite', () => {
    it('befriends the inviter and returns their profile', async () => {
      const res = await service.acceptInvite('me', 'token-abc-123');

      expect(friendRepo.addFriendship).toHaveBeenCalledWith('me', 'inviter-1');
      expect(res).toMatchObject({ userId: 'inviter-1', nickname: '민서' });
    });

    it('answers the same way when they are already friends', async () => {
      friendRepo.addFriendship.mockResolvedValue(false);

      await expect(service.acceptInvite('me', 'token-abc-123')).resolves.toMatchObject({
        userId: 'inviter-1',
      });
    });

    it('rejects your own link with 400', async () => {
      friendRepo.findUserByInviteToken.mockResolvedValue({ ...inviter, id: 'me' } as never);

      await expect(service.acceptInvite('me', 'token-abc-123')).rejects.toMatchObject({
        errorCode: 'SELF_INVITE',
        status: HttpStatus.BAD_REQUEST,
      });
      expect(friendRepo.addFriendship).not.toHaveBeenCalled();
    });

    it('rejects an unknown or reset token with 404', async () => {
      friendRepo.findUserByInviteToken.mockResolvedValue(null);

      await expect(service.acceptInvite('me', 'old-token-0000')).rejects.toMatchObject({
        errorCode: 'INVITE_NOT_FOUND',
        status: HttpStatus.NOT_FOUND,
      });
    });
  });

  describe('removeFriend', () => {
    it('removes the friendship', async () => {
      expect(await service.removeFriend('me', 'inviter-1')).toEqual({ friendId: 'inviter-1' });
    });

    it('rejects someone who is not a friend with 404', async () => {
      friendRepo.removeFriendship.mockResolvedValue(false);

      await expect(service.removeFriend('me', 'stranger')).rejects.toMatchObject({
        errorCode: 'FRIEND_NOT_FOUND',
        status: HttpStatus.NOT_FOUND,
      });
    });
  });

  it('rejects an unknown caller', async () => {
    userRepo.findById.mockResolvedValue(null);

    await expect(service.listFriends('ghost')).rejects.toMatchObject({ errorCode: 'USER_NOT_FOUND' });
    await expect(service.acceptInvite('ghost', 'token-abc-123')).rejects.toMatchObject({
      errorCode: 'USER_NOT_FOUND',
    });
  });
});
