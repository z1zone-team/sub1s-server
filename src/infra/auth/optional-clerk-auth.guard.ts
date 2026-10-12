import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../domain/user/ports/IUserRepository';
import { ClerkTokenService } from './clerk-token.service';

/**
 * 토큰이 있고 유효하면 `request.user`를 채우고, 없거나 잘못되었으면 비로그인으로 그대로 통과시킨다.
 * 비로그인도 쓸 수 있지만 로그인하면 더 나아지는 API(경로 검색의 개인화 추천)에 쓴다.
 * 토큰 오류를 401로 돌려주지 않는 것이 `ClerkAuthGuard`와의 차이다
 */
@Injectable()
export class OptionalClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(OptionalClerkAuthGuard.name);
  private readonly tokenService: ClerkTokenService;

  constructor(
    @Inject(USER_REPOSITORY)
    @Optional()
    userRepo?: IUserRepository,
    @Optional()
    configService?: ConfigService,
  ) {
    this.tokenService = new ClerkTokenService(userRepo, configService);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    if (!authHeader || typeof authHeader !== 'string') return true;

    const match = authHeader.match(/^Bearer\s+(.*)$/i);
    const token = match?.[1]?.trim();
    if (!token) return true;

    try {
      request.user = await this.tokenService.authenticate(token);
    } catch (error) {
      // 만료되었거나 잘못된 토큰은 비로그인과 같게 다룬다
      this.logger.debug(
        `Ignoring an invalid token on an optional-auth route: ${error instanceof Error ? error.message : error}`,
      );
    }
    return true;
  }
}
