import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import { MockAuthGuard } from '../../infra/auth/mock-auth.guard';
import {
  CreateTravelLogDto,
  TimelineQueryDto,
  TimelineResponseDto,
  TravelLogResponseDto,
} from './dto';
import { TravelLogService } from './travel-log.service';

@Controller('v1/travel')
@UseGuards(MockAuthGuard)
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
}
