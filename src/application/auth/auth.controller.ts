import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import { ClerkAuthGuard } from '../../infra/auth/clerk-auth.guard';
import { AuthService } from './auth.service';
import { AuthSyncRequestDto } from './dto/auth-sync-request.dto';
import { AuthSyncResponseDto } from './dto/auth-sync-response.dto';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
import { kstNowIso } from '../../common/utils/kst';

@ApiTags('Auth')
@ApiBearerAuth('clerk-auth')
@Controller('v1/auth')
@UseGuards(ClerkAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sync')
  @ApiOperation({
    summary: 'Clerk 유저 동기화',
    description: '로그인 후 Clerk 유저 프로필 정보를 DB에 동기화하고 회원 정보를 반환합니다.',
  })
  @SwaggerResponse({ status: 201, description: '유저 동기화 성공' })
  @SwaggerResponse({ status: 401, description: '인증 실패 (토큰 누락 또는 만료)' })
  async syncUser(
    @CurrentUser() user: AuthUser,
    @Body() dto: AuthSyncRequestDto,
  ): Promise<ApiResponse<AuthSyncResponseDto>> {
    const data = await this.authService.syncUser(user, dto);
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }

  @Get('me')
  @ApiOperation({
    summary: '내 프로필 및 랭킹 요약 조회',
    description: '현재 로그인된 사용자의 상세 프로필, 누적 이동거리, 랭킹 점수를 조회합니다.',
  })
  @SwaggerResponse({ status: 200, description: '프로필 조회 성공' })
  @SwaggerResponse({ status: 401, description: '인증 실패' })
  async getMe(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<UserProfileResponseDto>> {
    const data = await this.authService.getMe(user);
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }
}
