import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { StationLookupResultDto } from './dto/place-search-response.dto';
import { StationLookupQueryDto } from './dto/station-lookup-query.dto';
import { PlaceService } from './place.service';
import { kstNowIso } from '../../common/utils/kst';

@ApiTags('Stations')
@Controller('v1/stations')
export class StationController {
  constructor(private readonly placeService: PlaceService) {}

  @Get()
  @ApiOperation({
    summary: '역 ID로 역 정보 일괄 조회',
    description:
      '최근 도착지처럼 앱에 저장된 stationId 목록의 역 이름, 좌표, 호선 배지 정보를 한 번에 조회합니다. 요청한 순서대로 반환하며, 존재하지 않는 ID는 결과에서 제외합니다.',
  })
  @SwaggerResponse({
    status: 200,
    description: '조회 성공 (찾은 역만 반환, 모두 없으면 빈 배열)',
  })
  @SwaggerResponse({
    status: 400,
    description: 'ids 누락 또는 20개 초과',
  })
  async lookup(
    @Query() query: StationLookupQueryDto,
  ): Promise<ApiResponse<StationLookupResultDto>> {
    const data = await this.placeService.findStations(query.ids);
    return { success: true, data, timestamp: kstNowIso() };
  }
}
