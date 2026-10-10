import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse as SwaggerResponse, ApiTags } from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { HealthService, HealthStatus } from './health.service';
import { kstNowIso } from '../../common/utils/kst';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: '서버 및 데이터베이스 헬스체크' })
  @SwaggerResponse({ status: 200, description: '헬스체크 정상 응답' })
  async check(): Promise<ApiResponse<HealthStatus>> {
    const data = await this.healthService.check();
    return { success: true, data, timestamp: kstNowIso() };
  }
}
