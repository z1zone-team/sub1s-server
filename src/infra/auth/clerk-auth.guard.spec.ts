import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { IUserRepository } from '../../domain/user/ports/IUserRepository';
import * as clerkBackend from '@clerk/backend';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
}));

describe('ClerkAuthGuard', () => {
  let guard: ClerkAuthGuard;
  let userRepo: jest.Mocked<IUserRepository>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
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

    configService = {
      get: jest.fn().mockReturnValue('sk_test_mock_secret'),
    } as unknown as jest.Mocked<ConfigService>;

    guard = new ClerkAuthGuard(userRepo, configService);
    jest.clearAllMocks();
  });

  const createMockContext = (authHeader?: string): { context: ExecutionContext; request: any } => {
    const request: any = {
      headers: authHeader ? { authorization: authHeader } : {},
    };
    const context: ExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  it('should throw UnauthorizedException when Authorization header is missing', async () => {
    const { context } = createMockContext();
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when token is not Bearer format', async () => {
    const { context } = createMockContext('Basic token123');
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should allow mock_jwt_token in test environment and inject mock user', async () => {
    const { context, request } = createMockContext('Bearer mock_jwt_token');
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.user).toBeDefined();
    expect(request.user.clerkId).toBe('user_mock_test_1');
  });

  it('should verify token with Clerk and create user if not exists in DB', async () => {
    (clerkBackend.verifyToken as jest.Mock).mockResolvedValueOnce({
      sub: 'user_clerk_real_123',
    });

    userRepo.findByClerkId.mockResolvedValueOnce(null);
    userRepo.upsertByClerkId.mockResolvedValueOnce({
      id: 'uuid-1234',
      clerkId: 'user_clerk_real_123',
      nickname: '탐험가_al_123',
      profileImageUrl: null,
      name: null,
      nicknameCustomized: false,
      rankingVisibility: 'PUBLIC',
      isRankingPublic: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { context, request } = createMockContext('Bearer real_clerk_jwt_token');
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(clerkBackend.verifyToken).toHaveBeenCalledWith('real_clerk_jwt_token', {
      secretKey: 'sk_test_mock_secret',
    });
    expect(userRepo.upsertByClerkId).toHaveBeenCalled();
    expect(request.user.id).toBe('uuid-1234');
    expect(request.user.clerkId).toBe('user_clerk_real_123');
  });

  it('should throw UnauthorizedException when Clerk token verification fails', async () => {
    (clerkBackend.verifyToken as jest.Mock).mockRejectedValueOnce(
      new Error('Token expired')
    );

    const { context } = createMockContext('Bearer expired_jwt_token');
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
