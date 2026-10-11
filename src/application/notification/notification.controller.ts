import { Body, Controller, Delete, Get, Patch, Put, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { kstNowIso } from '../../common/utils/kst';
import { ClerkAuthGuard } from '../../infra/auth/clerk-auth.guard';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import {
  NotificationSettingsResponseDto,
  PushTokenRegisteredResponseDto,
  PushTokenRemovedResponseDto,
  RegisterPushTokenRequestDto,
  RemovePushTokenQueryDto,
  UpdateNotificationSettingsRequestDto,
} from './dto/notification.dto';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@ApiBearerAuth('clerk-auth')
@Controller('v1/users/me')
@UseGuards(ClerkAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Put('push-tokens')
  @ApiOperation({
    summary: '푸시 토큰 등록',
    description:
      '로그인 직후와 앱을 열 때마다 호출해도 됩니다. 같은 토큰이 이미 있으면 갱신하고, 다른 계정에 있던 토큰이면 지금 계정으로 옮깁니다. 사용자당 최대 10개(기기별)이며 넘으면 오래된 것부터 지웁니다.',
  })
  @SwaggerResponse({ status: 200, description: '등록됨' })
  @SwaggerResponse({
    status: 400,
    description: '토큰 형식 오류(INVALID_PUSH_TOKEN) 또는 아직 받지 않는 종류(UNSUPPORTED_PUSH_PROVIDER)',
  })
  async registerToken(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterPushTokenRequestDto,
  ): Promise<ApiResponse<PushTokenRegisteredResponseDto>> {
    const data = await this.notificationService.registerToken(user.id, dto);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Delete('push-tokens')
  @ApiOperation({
    summary: '푸시 토큰 삭제',
    description: '로그아웃할 때 호출합니다. 없는 토큰이어도 200이고 removed가 false입니다.',
  })
  async removeToken(
    @CurrentUser() user: AuthUser,
    @Query() query: RemovePushTokenQueryDto,
  ): Promise<ApiResponse<PushTokenRemovedResponseDto>> {
    const data = await this.notificationService.removeToken(user.id, query.token);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Get('notification-settings')
  @ApiOperation({ summary: '알림 설정 조회', description: '설정한 적이 없으면 기본값(켜짐)입니다.' })
  async getSettings(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<NotificationSettingsResponseDto>> {
    const data = await this.notificationService.getSettings(user.id);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Patch('notification-settings')
  @ApiOperation({
    summary: '알림 설정 수정',
    description: '보낸 항목만 바꿉니다. 하나도 없으면 400입니다.',
  })
  async updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateNotificationSettingsRequestDto,
  ): Promise<ApiResponse<NotificationSettingsResponseDto>> {
    const data = await this.notificationService.updateSettings(user.id, dto);
    return { success: true, data, timestamp: kstNowIso() };
  }
}
