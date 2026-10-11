import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { kstNowIso } from '../../common/utils/kst';
import { StationFacilitiesResponseDto } from './dto/station-facilities.dto';
import { FacilityService } from './facility.service';

@ApiTags('Stations')
@Controller('v1/stations')
export class FacilityController {
  constructor(private readonly facilityService: FacilityService) {}

  @Get(':stationId/facilities')
  @ApiOperation({
    summary: '역의 편의시설',
    description:
      '출구 번호와 주변 시설, 엘리베이터와 가까운 문을 돌려줍니다. 자료가 없는 역은 available=false로 200을 돌려줍니다.',
  })
  @SwaggerResponse({ status: 200, description: '역 편의시설' })
  @SwaggerResponse({ status: 404, description: '없는 역 (STATION_NOT_FOUND)' })
  facilities(
    @Param('stationId') stationId: string,
  ): ApiResponse<StationFacilitiesResponseDto> {
    const data = this.facilityService.getFacilities(stationId);
    return { success: true, data, timestamp: kstNowIso() };
  }
}
