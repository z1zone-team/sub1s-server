import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse as SwaggerResponse, ApiTags } from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { CongestionService } from './congestion.service';
import { TrainCongestionQueryDto } from './dto/train-congestion-query.dto';
import { TrainCongestionResponseDto } from './dto/train-congestion-response.dto';
import { kstNowIso } from '../../common/utils/kst';

@ApiTags('Congestion')
@Controller('v1/congestion')
export class CongestionController {
  constructor(private readonly congestionService: CongestionService) {}

  @Get('train')
  @ApiOperation({
    summary: '열차 칸별 혼잡도 조회',
    description:
      '특정 열차(호선, 열차번호, 정차역)의 1~10번 칸별 혼잡도(여유/보통/혼잡) 및 약냉방칸 정보를 조회합니다.',
  })
  @SwaggerResponse({ status: 200, description: '혼잡도 조회 성공' })
  @SwaggerResponse({ status: 400, description: '쿼리 파라미터 유효성 검사 실패' })
  async getTrainCongestion(
    @Query() query: TrainCongestionQueryDto,
  ): Promise<ApiResponse<TrainCongestionResponseDto>> {
    const data = await this.congestionService.getTrainCongestion(query);
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }
}
