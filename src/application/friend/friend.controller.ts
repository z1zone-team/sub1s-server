import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
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
import {
  AcceptInviteRequestDto,
  FriendDto,
  FriendListResponseDto,
  InviteTokenResponseDto,
  RemoveFriendResponseDto,
} from './dto/friend.dto';
import { FriendService } from './friend.service';

@ApiTags('Friends')
@ApiBearerAuth('clerk-auth')
@Controller('v1/friends')
@UseGuards(ClerkAuthGuard)
export class FriendController {
  constructor(private readonly friendService: FriendService) {}

  @Get()
  @ApiOperation({
    summary: '친구 목록',
    description: '최근에 친구가 된 순서로 전체를 돌려줍니다.',
  })
  async list(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<FriendListResponseDto>> {
    const data = await this.friendService.listFriends(user.id);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Get('invite')
  @ApiOperation({
    summary: '내 초대 토큰 조회',
    description:
      '없으면 만들어 돌려줍니다. 초대 링크는 앱이 이 토큰으로 조립합니다.',
  })
  async getInvite(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<InviteTokenResponseDto>> {
    const data = await this.friendService.getInviteToken(user.id);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Post('invite/reset')
  @ApiOperation({
    summary: '초대 토큰 재발급',
    description: '새 토큰을 발급하고 이전 링크는 무효가 됩니다.',
  })
  async resetInvite(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<InviteTokenResponseDto>> {
    const data = await this.friendService.resetInviteToken(user.id);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Post('accept')
  @ApiOperation({
    summary: '초대 수락',
    description:
      '수락하면 바로 서로 친구가 됩니다. 이미 친구여도 같은 응답을 돌려줍니다.',
  })
  @SwaggerResponse({ status: 200, description: '친구가 된 상대의 프로필' })
  @SwaggerResponse({ status: 400, description: '형식 오류 또는 내 링크 (SELF_INVITE)' })
  @SwaggerResponse({ status: 404, description: '없거나 재발급된 링크 (INVITE_NOT_FOUND)' })
  async accept(
    @CurrentUser() user: AuthUser,
    @Body() dto: AcceptInviteRequestDto,
  ): Promise<ApiResponse<FriendDto>> {
    const data = await this.friendService.acceptInvite(user.id, dto.inviteToken);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Delete(':friendId')
  @ApiOperation({ summary: '친구 끊기', description: '양쪽 모두에서 사라집니다.' })
  @SwaggerResponse({ status: 404, description: '친구가 아님 (FRIEND_NOT_FOUND)' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('friendId', ParseUUIDPipe) friendId: string,
  ): Promise<ApiResponse<RemoveFriendResponseDto>> {
    const data = await this.friendService.removeFriend(user.id, friendId);
    return { success: true, data, timestamp: kstNowIso() };
  }
}
