import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse as SwaggerResponse, ApiTags } from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { ClerkAuthGuard } from '../../infra/auth/clerk-auth.guard';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import {
  DeviateCheckRequestDto,
  OffRouteAlertDto,
  ReportLocationRequestDto,
  ReportPositionRequestDto,
  StartTrackingRequestDto,
  TrackingSessionDto,
} from './dto';
import { TrackingService } from './tracking.service';
import { kstNowIso } from '../../common/utils/kst';

@ApiTags('Tracking')
@UseGuards(ClerkAuthGuard)
@Controller('v1/routes/track')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post('start')
  @ApiOperation({
    summary: '실시간 주행 추적 세션 시작',
    description: '선택한 추천 경로를 기반으로 실시간 지하철 탑승 추적 세션을 시작합니다.',
  })
  @SwaggerResponse({ status: 201, description: '주행 세션 생성 성공' })
  async startTracking(
    @CurrentUser() user: AuthUser,
    @Body() dto: StartTrackingRequestDto,
  ): Promise<ApiResponse<TrackingSessionDto>> {
    const data = await this.trackingService.startTracking(user.id, dto);
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }

  @Post('deviate')
  @ApiOperation({
    summary: '오탑승 및 경로 이탈 체크 (REST Fallback)',
    description:
      '현재 감지된 역이 계획된 경로와 일치하는지 확인하고, 반대방향/환승누락 감지 시 즉시 맞은편 회차 경로를 반환합니다.',
  })
  @SwaggerResponse({ status: 200, description: '정상 주행 또는 회차 경로 안내 반환' })
  async checkDeviate(
    @CurrentUser() user: AuthUser,
    @Body() dto: DeviateCheckRequestDto,
  ): Promise<ApiResponse<OffRouteAlertDto | TrackingSessionDto>> {
    const data = await this.trackingService.checkDeviate(user.id, dto);
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }

  @Post('location')
  @ApiOperation({
    summary: '현재 위치 보고 및 세션 갱신',
    description: '지상 GPS 보정 또는 정차역 도착 시 위치를 보고하고 다음 정차역 ETA를 갱신합니다.',
  })
  @SwaggerResponse({ status: 200, description: '위치 갱신 성공' })
  async reportLocation(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReportLocationRequestDto,
  ): Promise<ApiResponse<TrackingSessionDto>> {
    const data = await this.trackingService.reportLocation(
      user.id,
      dto.sessionId,
      dto.currentStationId,
    );
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }

  @Post('position')
  @ApiOperation({
    summary: 'GPS 좌표로 위치 확인 및 경로 이탈 감지',
    description:
      '좌표에서 300m 안의 가장 가까운 역을 찾아 경로 위의 역이면 세션을 진행시키고, 경로에 없는 역이 연속 2번 감지되면 회차 경로(OffRouteAlertDto)를 반환합니다. 역 근처가 아니면 세션을 그대로 반환합니다.',
  })
  @SwaggerResponse({ status: 200, description: '세션 또는 회차 경로 반환' })
  @SwaggerResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async reportPosition(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReportPositionRequestDto,
  ): Promise<ApiResponse<OffRouteAlertDto | TrackingSessionDto>> {
    const data = await this.trackingService.reportPosition(user.id, dto);
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }

  @Get(':sessionId')
  @ApiOperation({
    summary: '주행 세션 상태 조회',
    description: '진행 중인 주행 추적 세션의 현재 상태 및 남은 소요 시간을 조회합니다.',
  })
  @SwaggerResponse({ status: 200, description: '세션 정보 반환' })
  @SwaggerResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async getSession(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
  ): Promise<ApiResponse<TrackingSessionDto>> {
    const data = await this.trackingService.getSession(user.id, sessionId);
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }
}
