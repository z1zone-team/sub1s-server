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
