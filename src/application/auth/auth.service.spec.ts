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
        isRankingPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.syncUser(mockAuthUser);

      expect(result.userId).toBe('user-uuid-1');
      expect(result.nickname).toBe('철도매니아');
      expect(userRepo.upsertByClerkId).toHaveBeenCalled();
    });

    it('updates user if user exists and dto contains changes', async () => {
      userRepo.findById.mockResolvedValueOnce({
        id: 'user-uuid-1',
        clerkId: 'user_clerk_123',
        nickname: '구닉네임',
        profileImageUrl: null,
        isRankingPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      userRepo.updateUser.mockResolvedValueOnce({
        id: 'user-uuid-1',
        clerkId: 'user_clerk_123',
        nickname: '새닉네임',
        profileImageUrl: null,
        isRankingPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.syncUser(mockAuthUser, { nickname: '새닉네임' });

      expect(result.nickname).toBe('새닉네임');
      expect(userRepo.updateUser).toHaveBeenCalledWith('user-uuid-1', {
        nickname: '새닉네임',
      });
    });
  });

  describe('getMe', () => {
    it('returns user profile with latest rank info', async () => {
      userRepo.findByIdWithLatestRank.mockResolvedValueOnce({
        id: 'user-uuid-1',
        clerkId: 'user_clerk_123',
        nickname: '철도매니아',
        profileImageUrl: null,
        isRankingPublic: true,
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
