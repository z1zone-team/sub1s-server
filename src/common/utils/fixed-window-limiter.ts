export interface LimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export class FixedWindowLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  tryConsume(key: string, now: number = Date.now()): LimitResult {
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.evictExpired(now);
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }

    if (window.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
      };
    }
    window.count += 1;
    return { allowed: true, retryAfterSec: 0 };
  }

  // 키가 한도를 넘게 쌓이면 만료된 창부터 지우고, 그래도 넘치면 가장 오래된 것부터 지운다
  private evictExpired(now: number): void {
    if (this.windows.size < this.maxKeys) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next();
      if (oldest.done) break;
      this.windows.delete(oldest.value);
    }
  }
}
