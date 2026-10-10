import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { PlaceSearchQueryDto } from './dto/place-search-query.dto';
import { PlaceSearchResultDto } from './dto/place-search-response.dto';
import { PlaceService } from './place.service';
import { kstNowIso } from '../../common/utils/kst';

@ApiTags('Places')
@Controller('v1/places')
export class PlaceController {
  constructor(private readonly placeService: PlaceService) {}

  @Get('search')
  @ApiOperation({
    summary: '역·장소 검색 (자동완성)',
    description:
      '검색어와 일치하는 지하철역(환승역은 호선 배지 목록으로 묶음)과 장소(V-World, 가장 가까운 역과 도보 정보 포함)를 한 목록으로 반환합니다. 장소를 선택하면 lat/lng를 경로 탐색의 destinationLat/Lng 또는 originLat/Lng로 전달합니다.',
  })
  @SwaggerResponse({
    status: 200,
    description: '검색 성공 (결과가 없으면 빈 배열)',
  })
  @SwaggerResponse({ status: 400, description: '검색어 누락 또는 형식 오류' })
  async search(
    @Query() query: PlaceSearchQueryDto,
  ): Promise<ApiResponse<PlaceSearchResultDto>> {
    const data = await this.placeService.search(query);
    return { success: true, data, timestamp: kstNowIso() };
  }
}
