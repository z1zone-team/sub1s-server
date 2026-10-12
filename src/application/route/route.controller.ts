import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse as SwaggerResponse, ApiTags } from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import {
  AuthUser,
  OptionalUser,
} from '../../infra/auth/current-user.decorator';
import { OptionalClerkAuthGuard } from '../../infra/auth/optional-clerk-auth.guard';
import { RouteSearchRequestDto } from './dto/route-search-request.dto';
import { RouteSearchResultDto } from './dto/route-search-response.dto';
import { RouteService } from './route.service';
import { kstNowIso } from '../../common/utils/kst';

@ApiTags('Routes')
@UseGuards(OptionalClerkAuthGuard)
@Controller('v1/routes')
export class RouteController {
  constructor(private readonly routeService: RouteService) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '4-모드 지하철 경로 탐색',
    description:
      '출발역과 도착역 사이의 모드(최적/여유/최소비용, 로그인하면 개인화 추천)별 경로와 예상 요금, 칸별 혼잡도 정보를 일괄 계산하여 반환합니다. 인증 토큰은 선택이며 로그인한 사용자에게만 추천(PERSONAL)이 포함됩니다.',
  })
  @SwaggerResponse({ status: 200, description: '경로 탐색 성공' })
  @SwaggerResponse({ status: 400, description: '잘못된 역 ID 또는 요청 형식' })
  @SwaggerResponse({ status: 404, description: '역을 찾을 수 없거나 경로 단절' })
  async search(
    @Body() dto: RouteSearchRequestDto,
    @OptionalUser() user?: AuthUser,
  ): Promise<ApiResponse<RouteSearchResultDto>> {
    const data = await this.routeService.search(dto, user?.id);
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }
}
