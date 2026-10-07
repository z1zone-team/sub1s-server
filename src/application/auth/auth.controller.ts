import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import { ClerkAuthGuard } from '../../infra/auth/clerk-auth.guard';
import { AuthService } from './auth.service';
import { AuthSyncRequestDto } from './dto/auth-sync-request.dto';
import { AuthSyncResponseDto } from './dto/auth-sync-response.dto';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';

@Controller('v1/auth')
@UseGuards(ClerkAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sync')
  async syncUser(
    @CurrentUser() user: AuthUser,
    @Body() dto: AuthSyncRequestDto,
  ): Promise<ApiResponse<AuthSyncResponseDto>> {
    const data = await this.authService.syncUser(user, dto);
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('me')
  async getMe(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<UserProfileResponseDto>> {
    const data = await this.authService.getMe(user);
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }
}
