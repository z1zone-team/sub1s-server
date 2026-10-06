import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

export const MOCK_USER_ID = '00000000-0000-0000-0000-000000000001';
export const MOCK_USER = {
  id: MOCK_USER_ID,
  clerkId: 'user_mock_test_1',
  nickname: '테스트유저',
  profileImageUrl: 'https://api.dicebear.com/7.x/bottts/png?seed=Sub1S',
};

@Injectable()
export class MockAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException(
        'Mock Auth Guard는 프로덕션 환경에서 사용할 수 없습니다.',
      );
    }
    const request = context.switchToHttp().getRequest();
    request.user = { ...MOCK_USER };
    return true;
  }
}
