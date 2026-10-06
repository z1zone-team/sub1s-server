import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import {
  DeviateCheckRequestDto,
  OffRouteAlertDto,
  ReportLocationRequestDto,
  StartTrackingRequestDto,
  TrackingSessionDto,
} from './dto';
import { TrackingService } from './tracking.service';

@Controller('v1/routes/track')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post('start')
  async startTracking(
    @Body() dto: StartTrackingRequestDto,
  ): Promise<ApiResponse<TrackingSessionDto>> {
    const data = await this.trackingService.startTracking(dto);
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('deviate')
  async checkDeviate(
    @Body() dto: DeviateCheckRequestDto,
  ): Promise<ApiResponse<OffRouteAlertDto | TrackingSessionDto>> {
    const data = await this.trackingService.checkDeviate(dto);
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('location')
  async reportLocation(
    @Body() dto: ReportLocationRequestDto,
  ): Promise<ApiResponse<TrackingSessionDto>> {
    const data = await this.trackingService.reportLocation(
      dto.sessionId,
      dto.currentStationId,
    );
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':sessionId')
  async getSession(
    @Param('sessionId') sessionId: string,
  ): Promise<ApiResponse<TrackingSessionDto>> {
    const data = await this.trackingService.getSession(sessionId);
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }
}
