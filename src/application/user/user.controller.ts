import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
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
}
