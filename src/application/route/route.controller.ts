import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { RouteSearchRequestDto } from './dto/route-search-request.dto';
import { RouteSearchResultDto } from './dto/route-search-response.dto';
import { RouteService } from './route.service';

@Controller('v1/routes')
export class RouteController {
  constructor(private readonly routeService: RouteService) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  async search(
    @Body() dto: RouteSearchRequestDto,
  ): Promise<ApiResponse<RouteSearchResultDto>> {
    const data = await this.routeService.search(dto);
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }
}
