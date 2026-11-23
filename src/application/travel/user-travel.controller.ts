import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse as SwaggerResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import { ClerkAuthGuard } from '../../infra/auth/clerk-auth.guard';
import {
  UserLineMapQueryDto,
  UserLineMapResponseDto,
  UserTimelineQueryDto,
  UserTimelineResponseDto,
  UserTravelStatsQueryDto,
  UserTravelStatsResponseDto,
} from './dto';
import { UserTravelService } from './user-travel.service';
import { kstNowIso } from '../../common/utils/kst';

@ApiTags('User Travel')
@ApiBearerAuth('clerk-auth')
@ApiParam({ name: 'userId', description: '조회할 사용자 ID (랭킹의 userId)' })
@Controller('v1/users/:userId/travel')
@UseGuards(ClerkAuthGuard)
export class UserTravelController {
  constructor(private readonly userTravelService: UserTravelService) {}

  @Get('timeline')
  @ApiOperation({
    summary: '다른 사용자의 월간 이동 기록 타임라인 조회',
    description:
      '특정 연/월의 다른 사용자 지하철 이용 내역을 최신순으로 조회합니다. 공개 범위는 랭킹과 같습니다(본인과 친구는 항상, 친구가 아니면 PUBLIC만).',
  })
  @SwaggerResponse({ status: 200, description: '타임라인 조회 성공' })
  @SwaggerResponse({ status: 403, description: '공개하지 않은 사용자' })
  @SwaggerResponse({ status: 404, description: '사용자 없음' })
  async getTimeline(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: UserTimelineQueryDto,
  ): Promise<ApiResponse<UserTimelineResponseDto>> {
    const data = await this.userTravelService.getTimeline(
      user.id,
      userId,
      query,
    );
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Get('stats')
  @ApiOperation({
    summary: '다른 사용자의 주행 통계 조회',
    description:
      '다른 사용자의 주/월/년/전체 기간별 총 이동거리, 이동횟수, 환승횟수, 최다 방문 역 TOP 3를 집계합니다.',
  })
  @SwaggerResponse({ status: 200, description: '통계 집계 반환' })
  @SwaggerResponse({ status: 403, description: '공개하지 않은 사용자' })
  @SwaggerResponse({ status: 404, description: '사용자 없음' })
  async getStats(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: UserTravelStatsQueryDto,
  ): Promise<ApiResponse<UserTravelStatsResponseDto>> {
    const data = await this.userTravelService.getTravelStats(
      user.id,
      userId,
      query,
    );
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Get('line-map')
  @ApiOperation({
    summary: '다른 사용자의 호선별 노선도 및 역 방문 여부 조회',
    description:
      '전체 호선/역 목록과 함께 해당 기간 내 다른 사용자가 방문한 역(visited: true)을 반환합니다.',
  })
  @SwaggerResponse({ status: 200, description: '노선도 반환' })
  @SwaggerResponse({ status: 403, description: '공개하지 않은 사용자' })
  @SwaggerResponse({ status: 404, description: '사용자 없음' })
  async getLineMap(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: UserLineMapQueryDto,
  ): Promise<ApiResponse<UserLineMapResponseDto>> {
    const data = await this.userTravelService.getLineMap(
      user.id,
      userId,
      query,
    );
    return { success: true, data, timestamp: kstNowIso() };
  }
}
