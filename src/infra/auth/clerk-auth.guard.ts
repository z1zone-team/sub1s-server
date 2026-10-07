import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import { PrismaService } from '../prisma/prisma.service';
import { MOCK_USER } from './mock-auth.guard';
import { AuthUser } from './current-user.decorator';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('인증 토큰이 제공되지 않았습니다.');
    }

    const match = authHeader.match(/^Bearer\s+(.*)$/i);
    if (!match || !match[1]) {
      throw new UnauthorizedException('올바른 Bearer 토큰 형식이 아닙니다.');
    }

    const token = match[1].trim();

    // 개발 및 테스트 환경 Mock 토큰 허용
    if (
      process.env.NODE_ENV !== 'production' &&
      (token === 'mock_jwt_token' || token.startsWith('mock_'))
    ) {
      request.user = { ...MOCK_USER } as AuthUser;
      return true;
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
      const errMsg = err instanceof Error ? err.message : 'Token verification failed';
      throw new UnauthorizedException(
        `유효하지 않거나 만료된 세션 토큰입니다: ${errMsg}`,
      );
    }

    const clerkId = payload.sub;
    if (!clerkId) {
      throw new UnauthorizedException('토큰에서 유저 식별자를 찾을 수 없습니다.');
    }

    // Prisma DB에서 유저 조회 또는 자동 최초 생성 (upsert)
    if (this.prisma) {
      let user = await this.prisma.user.findUnique({
        where: { clerkId },
      });

      if (!user) {
        user = await this.prisma.user.create({
          data: {
            clerkId,
            nickname: `탐험가_${clerkId.slice(-6)}`,
            profileImageUrl: null,
            isRankingPublic: true,
          },
        });
      }

      request.user = {
        id: user.id,
        clerkId: user.clerkId,
        nickname: user.nickname,
        profileImageUrl: user.profileImageUrl ?? undefined,
      } as AuthUser;
    } else {
      request.user = {
        id: '00000000-0000-0000-0000-000000000001',
        clerkId,
        nickname: `탐험가_${clerkId.slice(-6)}`,
      } as AuthUser;
    }

    return true;
  }
}
