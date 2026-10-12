import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { MOCK_USER } from './mock-auth.guard';

export interface AuthUser {
  id: string;
  clerkId: string;
  nickname: string;
  profileImageUrl?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user ?? { ...MOCK_USER };
  },
);

/**
 * 로그인한 사용자 또는 없으면 undefined. `CurrentUser`는 없으면 개발용 모의 사용자를 돌려주므로,
 * 비로그인과 로그인을 구별해야 하는 선택적 인증 API(`OptionalClerkAuthGuard`)에는 이것을 쓴다
 */
export const OptionalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user ?? undefined;
  },
);
