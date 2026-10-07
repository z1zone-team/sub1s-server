import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import { ClerkAuthGuard } from '../../infra/auth/clerk-auth.guard';
import { LineMapQueryDto, LineMapResponseDto } from './dto';
import { TravelLogService } from './travel-log.service';

@ApiTags('Line Map')
@ApiBearerAuth('clerk-auth')
@Controller('v1/line-map')
@UseGuards(ClerkAuthGuard)
export class LineMapController {
  constructor(private readonly travelLogService: TravelLogService) {}

  @Get()
  @ApiOperation({
    summary: '호선별 전체 역 노선망 및 방문 여부 조회',
    description: '호선별 역 목록과 공식 색상, 사용자별 방문 여부를 반환합니다.',
  })
  @SwaggerResponse({ status: 200, description: '노선망 데이터 반환' })
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
