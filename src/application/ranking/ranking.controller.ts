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
import { RankingQueryDto, RankingResponseDto } from './dto';
import { RankingService } from './ranking.service';
import { kstNowIso } from '../../common/utils/kst';

@ApiTags('Ranking')
@ApiBearerAuth('clerk-auth')
@Controller('v1/ranking')
@UseGuards(ClerkAuthGuard)
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  @Get()
  @ApiOperation({
    summary: '월간/전체 리더보드 랭킹 순위 조회',
    description:
      '기간별(월간/전체) 지하철 이동 거리 리더보드와 내 현재 순위, 획득 포인트를 페이지네이션으로 조회합니다.',
  })
  @SwaggerResponse({ status: 200, description: '리더보드 조회 성공' })
  @SwaggerResponse({ status: 401, description: '인증 실패' })
  async getRanking(
    @CurrentUser() user: AuthUser,
    @Query() query: RankingQueryDto,
  ): Promise<ApiResponse<RankingResponseDto>> {
    const data = await this.rankingService.getRanking(user.id, query);
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }
}
