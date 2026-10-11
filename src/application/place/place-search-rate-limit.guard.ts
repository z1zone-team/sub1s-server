import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { BusinessException } from '../../common/exceptions/business.exception';
import { FixedWindowLimiter } from '../../common/utils/fixed-window-limiter';

const WINDOW_MS = 60_000;
const DEFAULT_PER_MINUTE = 60;

/**
 * 운영에서는 nginx가 X-Real-IP에 접속자 IP를 덮어써서 넣는다.
 * nginx의 비인증 호출 제한은 Authorization 헤더만 붙이면 적용되지 않으므로, V-World 키를 쓰는 장소 검색은 여기서 한 번 더 막는다
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers['x-real-ip'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.trim() || request.ip || 'unknown';
}

@Injectable()
export class PlaceSearchRateLimitGuard implements CanActivate {
  private readonly limiter: FixedWindowLimiter;

  constructor(config: ConfigService) {
    const configured = Number(config.get('PLACE_SEARCH_PER_MINUTE'));
    this.limiter = new FixedWindowLimiter(
      configured > 0 ? configured : DEFAULT_PER_MINUTE,
      WINDOW_MS,
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const result = this.limiter.tryConsume(clientIp(http.getRequest<Request>()));
    if (result.allowed) return true;

    http.getResponse<Response>().setHeader('Retry-After', String(result.retryAfterSec));
    throw new BusinessException(
      'TOO_MANY_REQUESTS',
      '검색 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      HttpStatus.TOO_MANY_REQUESTS,
      { retryAfterSec: result.retryAfterSec },
    );
  }
}
