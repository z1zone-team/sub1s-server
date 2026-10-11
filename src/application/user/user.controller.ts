import { Body, Controller, Get, Patch, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiTags,
} from '@nestjs/swagger';
import { kstNowIso } from '../../common/utils/kst';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { ClerkAuthGuard } from '../../infra/auth/clerk-auth.guard';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import { MyProfileResponseDto } from './dto/my-profile-response.dto';
import {
  PreferencesResponseDto,
  UpdatePreferencesRequestDto,
} from './dto/preferences.dto';
import { UpdateProfileRequestDto } from './dto/update-profile-request.dto';
import { UserService } from './user.service';

@ApiTags('Users')
@ApiBearerAuth('clerk-auth')
@Controller('v1/users')
@UseGuards(ClerkAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Patch('me')
  @ApiOperation({
    summary: '내 프로필 수정',
    description:
      '이름, 닉네임, 이동 기록 공개 범위 중 보낸 항목만 수정합니다. 하나 이상 필요합니다.',
  })
  @SwaggerResponse({ status: 200, description: '수정된 프로필' })
  @SwaggerResponse({ status: 400, description: '형식 오류 또는 수정할 항목 없음' })
  @SwaggerResponse({ status: 409, description: '이미 사용 중인 닉네임 (NICKNAME_TAKEN)' })
  async updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileRequestDto,
  ): Promise<ApiResponse<MyProfileResponseDto>> {
    const data = await this.userService.updateProfile(user.id, dto);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Get('me/preferences')
  @ApiOperation({
    summary: '내 관심 설문 조회',
    description: '설문 전이면 빈 배열을 돌려줍니다.',
  })
  @SwaggerResponse({ status: 200, description: '저장된 용무와 경로 취향' })
  async getPreferences(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<PreferencesResponseDto>> {
    const data = await this.userService.getPreferences(user.id);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Put('me/preferences')
  @ApiOperation({
    summary: '내 관심 설문 저장',
    description:
      '용무와 경로 취향을 통째로 교체합니다. 각각 1개 이상이어야 하고 중복은 제거됩니다. 설문을 건너뛰면 호출하지 않습니다.',
  })
  @SwaggerResponse({ status: 200, description: '저장된 용무와 경로 취향' })
  @SwaggerResponse({ status: 400, description: '빈 배열 또는 허용되지 않는 값' })
  async replacePreferences(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePreferencesRequestDto,
  ): Promise<ApiResponse<PreferencesResponseDto>> {
    const data = await this.userService.replacePreferences(user.id, dto);
    return { success: true, data, timestamp: kstNowIso() };
  }
}
