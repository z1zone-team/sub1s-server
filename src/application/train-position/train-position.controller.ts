import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { kstNowIso } from '../../common/utils/kst';
import {
  LineTrainPositionsDto,
  TrainPositionsQueryDto,
} from './dto/train-positions.dto';
import { TrainPositionService } from './train-position.service';

@ApiTags('Trains')
@Controller('v1/trains')
export class TrainPositionController {
  constructor(private readonly trainPositions: TrainPositionService) {}

  @Get('positions')
  @ApiOperation({
    summary: '한 호선의 열차 위치(최근에 받은 값)',
    description:
      '서버가 서울시 열차 위치 API를 하루 예산 안에서 폴링해 둔 마지막 결과를 돌려줍니다. 실시간이 아니라 observedAt 시점의 위치이고, 서울시를 부르지 않으므로 자주 불러도 호출 예산을 쓰지 않습니다. 아직 모으지 못했거나 모으지 않는 호선도 200이며 status로 구분합니다.',
  })
  @SwaggerResponse({ status: 200, description: '열차 위치' })
  positions(
    @Query() query: TrainPositionsQueryDto,
  ): ApiResponse<LineTrainPositionsDto> {
    return {
      success: true,
      data: this.trainPositions.getLine(query.lineId),
      timestamp: kstNowIso(),
    };
  }
}
