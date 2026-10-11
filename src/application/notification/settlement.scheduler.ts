import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettlementService } from './settlement.service';

const TICK_MS = 60_000;

/**
 * 1분마다 정산할 때인지 확인한다. 같은 달에 두 번 보내지 않는 것은 DB 기록이 보장하므로
 * 재시작하거나 놓쳐도 안전하다. 서버가 하나라고 가정한다
 */
@Injectable()
export class SettlementScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SettlementScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly settlement: SettlementService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled()) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.settlement.runIfDue();
    } catch (error) {
      this.logger.error(
        `Monthly settlement failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    } finally {
      this.running = false;
    }
  }

  // 테스트 환경이나 PUSH_SCHEDULER_ENABLED=false에서는 켜지 않는다
  private enabled(): boolean {
    return (
      process.env.NODE_ENV !== 'test' &&
      this.config.get<string>('PUSH_SCHEDULER_ENABLED') !== 'false'
    );
  }
}
