import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ClerkAuthGuard } from '../../infra/auth/clerk-auth.guard';
import { AuthUser } from '../../infra/auth/current-user.decorator';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  const mockUser: AuthUser = {
    id: 'user-uuid-1',
    clerkId: 'user_clerk_123',
    nickname: '철도매니아',
    profileImageUrl: 'https://avatar.url',
  };

  beforeEach(async () => {
    authService = {
      syncUser: jest.fn(),
      getMe: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
      ],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should sync user profile and return ApiResponse', async () => {
    const mockSyncResult = {
      userId: 'user-uuid-1',
      clerkId: 'user_clerk_123',
      nickname: '철도매니아',
      profileImageUrl: 'https://avatar.url',
      isRankingPublic: true,
    };
    authService.syncUser.mockResolvedValueOnce(mockSyncResult);

    const res = await controller.syncUser(mockUser, { nickname: '철도매니아' });

    expect(res.success).toBe(true);
    expect(res.data).toEqual(mockSyncResult);
    expect(authService.syncUser).toHaveBeenCalledWith(mockUser, { nickname: '철도매니아' });
  });

  it('should return me profile and return ApiResponse', async () => {
    const mockProfileResult = {
      id: 'user-uuid-1',
      clerkId: 'user_clerk_123',
      nickname: '철도매니아',
      profileImageUrl: 'https://avatar.url',
      totalDistanceMeters: 15400,
      currentStreakDays: 5,
      rankScore: 1200,
      isRankingPublic: true,
      createdAt: '2026-10-07T00:00:00.000Z',
    };
    authService.getMe.mockResolvedValueOnce(mockProfileResult);

    const res = await controller.getMe(mockUser);

    expect(res.success).toBe(true);
    expect(res.data).toEqual(mockProfileResult);
    expect(authService.getMe).toHaveBeenCalledWith(mockUser);
  });
});
