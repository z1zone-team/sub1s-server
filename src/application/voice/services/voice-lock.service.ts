import { HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { ValkeyService } from '../../../infra/queue/valkey.service';

export interface IVoiceLockService {
  acquireLock(userId: string, ttlSeconds?: number): Promise<boolean>;
  releaseLock(userId: string): Promise<void>;
  assertLock(userId: string, ttlSeconds?: number): Promise<void>;
}

@Injectable()
export class VoiceLockService implements IVoiceLockService {
  private readonly logger = new Logger(VoiceLockService.name);
  private readonly locks = new Map<string, number>();
  /** Valkey에 만든 락 키. 테스트에서 비울 때 쓴다 */
  private readonly valkeyKeys = new Set<string>();

  constructor(@Optional() private readonly valkey?: ValkeyService) {}

  /**
   * 5초 동안 동일 유저의 중복 음성 요청을 원천 차단합니다 (`SET NX EX`).
   * Valkey를 쓸 수 있으면 서버가 여러 대여도 같은 락을 보고, 없거나 연결이 끊기면 서버 메모리로 대체합니다.
   */
  async acquireLock(userId: string, ttlSeconds: number = 5): Promise<boolean> {
    const key = `lock:voice:${userId}`;

    if (this.valkey?.enabled) {
      try {
        const acquired = await this.valkey.setIfAbsent(key, ttlSeconds);
        if (acquired) this.valkeyKeys.add(key);
        return acquired;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Valkey lock failed, using memory lock: ${message}`);
      }
    }

    const now = Date.now();
    const expiresAt = this.locks.get(key);
    if (expiresAt && expiresAt > now) {
      return false;
    }

    this.locks.set(key, now + ttlSeconds * 1000);
    return true;
  }

  async releaseLock(userId: string): Promise<void> {
    const key = `lock:voice:${userId}`;
    this.locks.delete(key);
    if (this.valkey?.enabled) {
      await this.valkey.delete(key).catch(() => undefined);
    }
  }

  async assertLock(userId: string, ttlSeconds: number = 5): Promise<void> {
    const acquired = await this.acquireLock(userId, ttlSeconds);
    if (!acquired) {
      throw new HttpException(
        '이전 음성 요청을 처리 중입니다. 잠시만 기다려주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** 만든 락을 모두 지운다(테스트용). Valkey에 만든 락도 함께 지운다 */
  async clear(): Promise<void> {
    this.locks.clear();
    const keys = [...this.valkeyKeys];
    this.valkeyKeys.clear();
    if (this.valkey?.enabled) {
      await Promise.all(
        keys.map((key) => this.valkey!.delete(key).catch(() => undefined)),
      );
    }
  }
}
