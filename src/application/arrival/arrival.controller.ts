import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { kstNowIso } from '../../common/utils/kst';
import { ArrivalService } from './arrival.service';
import {
  NextTrainsQueryDto,
  NextTrainsResponseDto,
} from './dto/next-trains.dto';

@ApiTags('Stations')
@Controller('v1/stations')
export class ArrivalController {
  constructor(private readonly arrivalService: ArrivalService) {}

  @Get(':stationId/next-trains')
  @ApiOperation({
    summary: '역의 다음 열차 정보',
    description:
      '방향별로 가까운 열차의 행선지와 도착까지 남은 시간을 돌려줍니다. 정보를 가져오지 못해도 200이며 status로 구분합니다.',
  })
  @SwaggerResponse({ status: 200, description: '다음 열차 정보' })
  @SwaggerResponse({ status: 404, description: '없는 역 (STATION_NOT_FOUND)' })
  async nextTrains(
    @Param('stationId') stationId: string,
    @Query() query: NextTrainsQueryDto,
  ): Promise<ApiResponse<NextTrainsResponseDto>> {
    const data = await this.arrivalService.getNextTrains(stationId, query.limit);
    return { success: true, data, timestamp: kstNowIso() };
  }
}
