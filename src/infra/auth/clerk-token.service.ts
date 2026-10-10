import {
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../domain/user/ports/IUserRepository';
import { MOCK_USER } from './mock-auth.guard';
import { AuthUser } from './current-user.decorator';

// Verifies a Clerk session token and resolves the user. Shared by the HTTP guard and the WebSocket handshake.
@Injectable()
export class ClerkTokenService {
  constructor(
    @Inject(USER_REPOSITORY)
    @Optional()
    private readonly userRepo?: IUserRepository,
    @Optional()
    private readonly configService?: ConfigService,
  ) {}

  async authenticate(token: string): Promise<AuthUser> {
    // 개발 및 테스트 환경 Mock 토큰 허용
    if (
      process.env.NODE_ENV !== 'production' &&
      (token === 'mock_jwt_token' || token.startsWith('mock_'))
    ) {
      return { ...MOCK_USER } as AuthUser;
    }

    const secretKey =
      this.configService?.get<string>('CLERK_SECRET_KEY') ||
      process.env.CLERK_SECRET_KEY;

    if (!secretKey) {
      throw new UnauthorizedException(
        '서버에 CLERK_SECRET_KEY가 설정되어 있지 않습니다.',
      );
    }

    let payload: { sub?: string };
    try {
      payload = await verifyToken(token, { secretKey });
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : 'Token verification failed';
      throw new UnauthorizedException(
        `유효하지 않거나 만료된 세션 토큰입니다: ${errMsg}`,
      );
    }

    const clerkId = payload.sub;
    if (!clerkId) {
      throw new UnauthorizedException(
        '토큰에서 유저 식별자를 찾을 수 없습니다.',
      );
    }

    // Repository를 통한 유저 조회 또는 자동 최초 생성 (upsert)
    if (this.userRepo) {
      let user = await this.userRepo.findByClerkId(clerkId);

      if (!user) {
        user = await this.userRepo.upsertByClerkId({
          clerkId,
          nickname: `탐험가_${clerkId.slice(-6)}`,
          profileImageUrl: null,
        });
      }

      return {
        id: user.id,
        clerkId: user.clerkId,
        nickname: user.nickname,
        profileImageUrl: user.profileImageUrl ?? undefined,
      } as AuthUser;
    }

    return {
      id: '00000000-0000-0000-0000-000000000001',
      clerkId,
      nickname: `탐험가_${clerkId.slice(-6)}`,
    } as AuthUser;
  }
}
