import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import { MockAuthGuard } from '../../infra/auth/mock-auth.guard';
import { RankingQueryDto, RankingResponseDto } from './dto';
import { RankingService } from './ranking.service';

@Controller('v1/ranking')
@UseGuards(MockAuthGuard)
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  @Get()
  async getRanking(
    @CurrentUser() user: AuthUser,
    @Query() query: RankingQueryDto,
  ): Promise<ApiResponse<RankingResponseDto>> {
    const data = await this.rankingService.getRanking(user.id, query);
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }
}
