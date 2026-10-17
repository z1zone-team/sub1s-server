import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infra/prisma/prisma.service';

export type AiStatus = 'up' | 'down' | 'not_configured';

export interface HealthStatus {
  status: 'ok';
  database: 'up';
  ai: AiStatus;
  whisperModel?: string;
}

const AI_TIMEOUT_MS = 1500;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: '데이터베이스에 연결할 수 없습니다.',
      });
    }
    return { status: 'ok', database: 'up', ...(await this.checkAi()) };
  }

  /** AI 서비스는 정보로만 알린다. 죽어도 서버 헬스체크는 DB 기준 그대로 통과한다 */
  private async checkAi(): Promise<Pick<HealthStatus, 'ai' | 'whisperModel'>> {
    const base = this.config.get<string>('AI_SERVICE_URL');
    if (!base) return { ai: 'not_configured' };

    try {
      const res = await fetch(`${base.replace(/\/+$/, '')}/health`, {
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (!res.ok) return { ai: 'down' };
      const body = (await res.json()) as { status?: unknown; whisper_model?: unknown };
      if (body.status !== 'ok') return { ai: 'down' };
      return {
        ai: 'up',
        ...(typeof body.whisper_model === 'string' ? { whisperModel: body.whisper_model } : {}),
      };
    } catch {
      return { ai: 'down' };
    }
  }
}
