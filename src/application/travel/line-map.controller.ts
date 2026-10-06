import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import { MockAuthGuard } from '../../infra/auth/mock-auth.guard';
import { LineMapQueryDto, LineMapResponseDto } from './dto';
import { TravelLogService } from './travel-log.service';

@Controller('v1/line-map')
@UseGuards(MockAuthGuard)
export class LineMapController {
  constructor(private readonly travelLogService: TravelLogService) {}

  @Get()
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
