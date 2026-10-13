import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../domain/user/ports/IUserRepository';
import { AuthUser } from '../../infra/auth/current-user.decorator';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: jest.Mocked<IUserRepository>;

  const mockAuthUser: AuthUser = {
    id: 'user-uuid-1',
    clerkId: 'user_clerk_123',
    nickname: '철도매니아',
  };

  beforeEach(async () => {
    userRepo = {
      findById: jest.fn(),
      findByIdWithLatestRank: jest.fn(),
      findByClerkId: jest.fn(),
      upsertByClerkId: jest.fn(),
      updateUser: jest.fn(),
      upsertPlaceholder: jest.fn(),
      updateProfile: jest.fn(),
      isNicknameTaken: jest.fn(),
      syncNickname: jest.fn(),
      findPreferences: jest.fn(),
      replacePreferences: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: USER_REPOSITORY,
          useValue: userRepo,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('syncUser', () => {
    it('creates new user via upsertByClerkId if user not found by id', async () => {
      userRepo.findById.mockResolvedValueOnce(null);
      userRepo.upsertByClerkId.mockResolvedValueOnce({
        id: 'user-uuid-1',
        clerkId: 'user_clerk_123',
        nickname: '철도매니아',
        profileImageUrl: null,
        name: null,
        nicknameCustomized: false,
        rankingVisibility: 'PUBLIC' as const,
        inviteToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.syncUser(mockAuthUser);

      expect(result.userId).toBe('user-uuid-1');
      expect(result.nickname).toBe('철도매니아');
      expect(userRepo.upsertByClerkId).toHaveBeenCalled();
    });

    const existingUser = {
      id: 'user-uuid-1',
      clerkId: 'user_clerk_123',
      name: null,
      nickname: '클러크이름',
      nicknameCustomized: false,
      profileImageUrl: null,
      rankingVisibility: 'PUBLIC' as const,
      inviteToken: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('applies the Clerk nickname while the user has not chosen one', async () => {
      userRepo.findById.mockResolvedValueOnce(existingUser);
      userRepo.syncNickname.mockResolvedValueOnce({ ...existingUser, nickname: '새클러크이름' });

      const result = await service.syncUser(mockAuthUser, { nickname: '새클러크이름' });

      expect(userRepo.syncNickname).toHaveBeenCalledWith('user-uuid-1', '새클러크이름');
      expect(result.nickname).toBe('새클러크이름');
    });

    it('turns spaces in the Clerk name into underscores when applying it', async () => {
      userRepo.findById.mockResolvedValueOnce(existingUser);
      userRepo.syncNickname.mockResolvedValueOnce({ ...existingUser, nickname: '수현_박' });

      await service.syncUser(mockAuthUser, { nickname: '수현 박' });

      expect(userRepo.syncNickname).toHaveBeenCalledWith('user-uuid-1', '수현_박');
    });

    it('repairs a stored nickname that has a space when the user never chose one', async () => {
      userRepo.findById.mockResolvedValueOnce({ ...existingUser, nickname: '수현 박' });
      userRepo.syncNickname.mockResolvedValueOnce({ ...existingUser, nickname: '수현_박' });

      const result = await service.syncUser(mockAuthUser, { nickname: '수현 박' });

      expect(userRepo.syncNickname).toHaveBeenCalledWith('user-uuid-1', '수현_박');
      expect(result.nickname).toBe('수현_박');
    });

    it('does not write again once the sanitized nickname is already stored', async () => {
      userRepo.findById.mockResolvedValueOnce({ ...existingUser, nickname: '수현_박' });

      await service.syncUser(mockAuthUser, { nickname: '수현 박' });

      expect(userRepo.syncNickname).not.toHaveBeenCalled();
    });

    it('creates a new user with the sanitized Clerk name', async () => {
      userRepo.findById.mockResolvedValueOnce(null);
      userRepo.upsertByClerkId.mockResolvedValueOnce({ ...existingUser, nickname: '수현_박' });

      await service.syncUser(mockAuthUser, { nickname: '수현 박' });

      expect(userRepo.upsertByClerkId).toHaveBeenCalledWith(
        expect.objectContaining({ nickname: '수현_박' }),
      );
    });

    it('falls back to the auth user nickname when the Clerk name cannot be a nickname', async () => {
      userRepo.findById.mockResolvedValueOnce(null);
      userRepo.upsertByClerkId.mockResolvedValueOnce({ ...existingUser });

      await service.syncUser(mockAuthUser, { nickname: '!!' });

      expect(userRepo.upsertByClerkId).toHaveBeenCalledWith(
        expect.objectContaining({ nickname: mockAuthUser.nickname }),
      );
    });

    it('keeps the nickname the user chose', async () => {
      userRepo.findById.mockResolvedValueOnce({
        ...existingUser,
        nickname: '내가정한닉네임',
        nicknameCustomized: true,
      });

      const result = await service.syncUser(mockAuthUser, { nickname: '클러크이름' });

      expect(result.nickname).toBe('내가정한닉네임');
      expect(userRepo.syncNickname).not.toHaveBeenCalled();
      expect(userRepo.updateUser).not.toHaveBeenCalled();
    });

    it('does not write when the Clerk nickname only differs in case', async () => {
      userRepo.findById.mockResolvedValueOnce({ ...existingUser, nickname: 'Kim' });

      await service.syncUser(mockAuthUser, { nickname: 'KIM' });

      expect(userRepo.syncNickname).not.toHaveBeenCalled();
    });

    it('updates the profile image of an existing user', async () => {
      userRepo.findById.mockResolvedValueOnce(existingUser);
      userRepo.updateUser.mockResolvedValueOnce({ ...existingUser, profileImageUrl: 'https://new.img' });

      const result = await service.syncUser(mockAuthUser, { profileImageUrl: 'https://new.img' });

      expect(userRepo.updateUser).toHaveBeenCalledWith('user-uuid-1', { profileImageUrl: 'https://new.img' });
      expect(result.profileImageUrl).toBe('https://new.img');
    });

    it('returns the name and ranking visibility instead of isRankingPublic', async () => {
      userRepo.findById.mockResolvedValueOnce({
        ...existingUser,
        name: '박지훈',
        rankingVisibility: 'ANONYMOUS' as const,
      });

      const result = await service.syncUser(mockAuthUser);

      expect(result.name).toBe('박지훈');
      expect(result.rankingVisibility).toBe('ANONYMOUS');
      expect(result).not.toHaveProperty('isRankingPublic');
    });
  });

  describe('getMe', () => {
    it('returns user profile with latest rank info', async () => {
      userRepo.findByIdWithLatestRank.mockResolvedValueOnce({
        id: 'user-uuid-1',
        clerkId: 'user_clerk_123',
        nickname: '철도매니아',
        profileImageUrl: null,
        name: null,
        nicknameCustomized: false,
        rankingVisibility: 'PUBLIC' as const,
        inviteToken: null,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        updatedAt: new Date(),
        rankScores: [
          {
            id: 'rank-1',
            userId: 'user-uuid-1',
            periodType: 'MONTHLY',
            periodKey: '2026-10',
            totalPoints: 1200,
            totalDistanceKm: 15.4,
            rankPosition: 1,
            updatedAt: new Date(),
          },
        ],
      });

      const result = await service.getMe(mockAuthUser);

      expect(result.id).toBe('user-uuid-1');
      expect(result.rankScore).toBe(1200);
      expect(result.totalDistanceMeters).toBe(15400);
    });

    it('throws NotFoundException if user is not in database', async () => {
      userRepo.findByIdWithLatestRank.mockResolvedValueOnce(null);

      await expect(service.getMe(mockAuthUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
