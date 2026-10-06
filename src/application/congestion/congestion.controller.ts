import { Controller, Get, Query } from '@nestjs/common';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { CongestionService } from './congestion.service';
import { TrainCongestionQueryDto } from './dto/train-congestion-query.dto';
import { TrainCongestionResponseDto } from './dto/train-congestion-response.dto';

@Controller('v1/congestion')
export class CongestionController {
  constructor(private readonly congestionService: CongestionService) {}

  @Get('train')
  async getTrainCongestion(
    @Query() query: TrainCongestionQueryDto,
  ): Promise<ApiResponse<TrainCongestionResponseDto>> {
    const data = await this.congestionService.getTrainCongestion(query);
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }
}
