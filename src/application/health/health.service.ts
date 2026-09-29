import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface HealthStatus {
  status: 'ok';
  database: 'up';
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: '데이터베이스에 연결할 수 없습니다.',
      });
    }
    return { status: 'ok', database: 'up' };
  }
}
