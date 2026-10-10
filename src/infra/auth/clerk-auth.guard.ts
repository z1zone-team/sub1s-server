import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../domain/user/ports/IUserRepository';
import { ClerkTokenService } from './clerk-token.service';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
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

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('인증 토큰이 제공되지 않았습니다.');
    }

    const match = authHeader.match(/^Bearer\s+(.*)$/i);
    if (!match || !match[1]) {
      throw new UnauthorizedException('올바른 Bearer 토큰 형식이 아닙니다.');
    }

    const token = match[1].trim();

    request.user = await this.tokenService.authenticate(token);
    return true;
  }
}
