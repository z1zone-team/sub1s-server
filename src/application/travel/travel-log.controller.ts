import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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

@Controller('v1/travel')
@UseGuards(ClerkAuthGuard)
export class TravelLogController {
  constructor(private readonly travelLogService: TravelLogService) {}

  @Post('log')
  async createLog(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTravelLogDto,
  ): Promise<ApiResponse<TravelLogResponseDto>> {
    const data = await this.travelLogService.createLog(user.id, dto);
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('timeline')
  async getTimeline(
    @CurrentUser() user: AuthUser,
    @Query() query: TimelineQueryDto,
  ): Promise<ApiResponse<TimelineResponseDto>> {
    const data = await this.travelLogService.getTimeline(user.id, query);
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('stats')
  async getStats(
    @CurrentUser() user: AuthUser,
    @Query() query: TravelStatsQueryDto,
  ): Promise<ApiResponse<TravelStatsResponseDto>> {
    const data = await this.travelLogService.getTravelStats(user.id, query);
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('line-map')
  async getLineMap(
    @CurrentUser() user: AuthUser,
    @Query() query: LineMapQueryDto,
  ): Promise<ApiResponse<LineMapResponseDto>> {
    const data = await this.travelLogService.getLineMap(user.id, query);
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }
}
