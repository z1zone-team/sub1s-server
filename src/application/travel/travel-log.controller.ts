import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import { ClerkAuthGuard } from '../../infra/auth/clerk-auth.guard';
import {
  CreateTravelLogDto,
  LineMapQueryDto,
  LineMapResponseDto,
  TimelineQueryDto,
  TimelineResponseDto,
  TravelLogResponseDto,
  TravelStatsQueryDto,
  TravelStatsResponseDto,
} from './dto';
import { TravelLogService } from './travel-log.service';
import { kstNowIso } from '../../common/utils/kst';

@ApiTags('Travel')
@ApiBearerAuth('clerk-auth')
@Controller('v1/travel')
@UseGuards(ClerkAuthGuard)
export class TravelLogController {
  constructor(private readonly travelLogService: TravelLogService) {}

  @Post('log')
  @ApiOperation({
    summary: '지하철 이동 완료 기록 저장',
    description:
      '출발역과 도착역 이동을 완료하고 3-Tier 하이브리드 암호화된 궤적을 저장하며 랭킹 점수를 자동 적립합니다.',
  })
  @SwaggerResponse({ status: 201, description: '이동 완료 기록 저장 성공' })
  @SwaggerResponse({ status: 401, description: '인증 실패' })
  async createLog(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTravelLogDto,
  ): Promise<ApiResponse<TravelLogResponseDto>> {
    const data = await this.travelLogService.createLog(user.id, dto);
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }

  @Get('timeline')
  @ApiOperation({
    summary: '월간 이동 기록 타임라인 조회',
    description: '특정 연/월의 사용자 지하철 이용 내역과 총 이동 거리를 최신순으로 조회합니다.',
  })
  @SwaggerResponse({ status: 200, description: '타임라인 조회 성공' })
  async getTimeline(
    @CurrentUser() user: AuthUser,
    @Query() query: TimelineQueryDto,
  ): Promise<ApiResponse<TimelineResponseDto>> {
    const data = await this.travelLogService.getTimeline(user.id, query);
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }

  @Get('stats')
  @ApiOperation({
    summary: '사용자 주행 통계 조회',
    description: '주/월/년/전체 기간별 총 이동거리, 이동횟수, 환승횟수, 최다 방문 역 TOP 3를 집계합니다.',
  })
  @SwaggerResponse({ status: 200, description: '통계 집계 반환' })
  async getStats(
    @CurrentUser() user: AuthUser,
    @Query() query: TravelStatsQueryDto,
  ): Promise<ApiResponse<TravelStatsResponseDto>> {
    const data = await this.travelLogService.getTravelStats(user.id, query);
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }

  @Get('line-map')
  @ApiOperation({
    summary: '호선별 노선도 및 역 방문 여부 조회',
    description: '전체 호선/역 목록과 함께 해당 기간 내 사용자가 방문한 역(visited: true)을 반환합니다.',
  })
  @SwaggerResponse({ status: 200, description: '노선도 반환' })
  async getLineMap(
    @CurrentUser() user: AuthUser,
    @Query() query: LineMapQueryDto,
  ): Promise<ApiResponse<LineMapResponseDto>> {
    const data = await this.travelLogService.getLineMap(user.id, query);
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }
}
