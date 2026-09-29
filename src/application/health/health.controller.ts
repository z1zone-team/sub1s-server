import { Controller, Get } from '@nestjs/common';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { HealthService, HealthStatus } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(): Promise<ApiResponse<HealthStatus>> {
    const data = await this.healthService.check();
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
