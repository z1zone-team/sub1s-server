import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

export interface IVoiceLockService {
  acquireLock(userId: string, ttlSeconds?: number): Promise<boolean>;
  releaseLock(userId: string): Promise<void>;
  assertLock(userId: string, ttlSeconds?: number): Promise<void>;
}

@Injectable()
export class VoiceLockService implements IVoiceLockService {
  private readonly locks = new Map<string, number>();

  /**
   * 5초 동안 동일 유저의 중복 음성 요청을 원천 차단합니다 (Atomic SET NX EX 시뮬레이션).
   */
  async acquireLock(userId: string, ttlSeconds: number = 5): Promise<boolean> {
    const now = Date.now();
    const key = `lock:voice:${userId}`;
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

  clear(): void {
    this.locks.clear();
  }
}
