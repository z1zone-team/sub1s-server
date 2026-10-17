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
  @ApiOperation({
    summary: '서버, 데이터베이스, AI 서비스 헬스체크',
    description:
      'status는 데이터베이스 기준이다. ai는 AI 서비스 상태(up, down, not_configured)를 정보로만 알리고 down이어도 200이다. ai가 up이면 whisperModel이 함께 온다.',
  })
  @SwaggerResponse({ status: 200, description: '헬스체크 정상 응답' })
  @SwaggerResponse({ status: 503, description: '데이터베이스 연결 실패 (DATABASE_UNAVAILABLE)' })
  async check(): Promise<ApiResponse<HealthStatus>> {
    const data = await this.healthService.check();
    return { success: true, data, timestamp: kstNowIso() };
  }
}
