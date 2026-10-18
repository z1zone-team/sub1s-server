import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const CONNECT_WAIT_MS = 3000;

export interface ValkeyOptions {
  host: string;
  port: number;
  password?: string;
}

/**
 * Valkey(Redis 호환) 연결. `VALKEY_HOST`가 없으면 꺼진 상태(`enabled` false)이고,
 * 큐와 분산 락은 쓰지 않고 서버 메모리로 대체한다(개발 환경)
 */
@Injectable()
export class ValkeyService implements OnModuleDestroy {
  private readonly logger = new Logger(ValkeyService.name);
  private readonly connections: Redis[] = [];
  private client?: Redis;
  readonly options: ValkeyOptions | null;

  constructor(config: ConfigService) {
    const host = config.get<string>('VALKEY_HOST');
    this.options = host
      ? {
          host,
          port: Number(config.get<string>('VALKEY_PORT') ?? 6379),
          password: config.get<string>('VALKEY_PASSWORD') || undefined,
        }
      : null;
  }

  get enabled(): boolean {
    return this.options !== null;
  }

  /**
   * BullMQ용 연결을 새로 만든다. 큐 하나당 연결을 따로 써야 하고, 워커와 이벤트 구독은
   * 블로킹 명령을 쓰므로 `maxRetriesPerRequest`를 끈다
   */
  createConnection(blocking = false): Redis {
    const connection = this.connect(
      blocking ? { maxRetriesPerRequest: null } : {},
    );
    this.connections.push(connection);
    return connection;
  }

  /** `SET key 1 EX ttl NX`. 키가 없어서 새로 만들었으면 true */
  async setIfAbsent(key: string, ttlSeconds: number): Promise<boolean> {
    const client = await this.readyClient();
    const reply = await client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return reply === 'OK';
  }

  /**
   * 자리 하나를 잡는다. 지금 잡은 수가 limit 미만이면 하나 늘리고 true. 세는 것과 늘리는 것이 한 번에 일어나
   * 동시에 요청해도 limit을 넘지 않는다. 반납이 빠져도 ttlSeconds 뒤에는 키가 사라져 다시 0에서 시작한다
   */
  async acquireSlot(
    key: string,
    limit: number,
    ttlSeconds: number,
  ): Promise<boolean> {
    const client = await this.readyClient();
    const reply = await client.eval(
      `local n = tonumber(redis.call('GET', KEYS[1]) or '0')
if n >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1`,
      1,
      key,
      String(limit),
      String(ttlSeconds),
    );
    return reply === 1;
  }

  /** 잡은 자리를 하나 돌려준다. 0 아래로는 내려가지 않는다 */
  async releaseSlot(key: string): Promise<void> {
    const client = await this.readyClient();
    await client.eval(
      `local n = tonumber(redis.call('GET', KEYS[1]) or '0')
if n > 0 then redis.call('DECR', KEYS[1]) end
return 0`,
      1,
      key,
    );
  }

  async delete(key: string): Promise<void> {
    await (await this.readyClient()).del(key);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [this.client, ...this.connections]
        .filter((connection): connection is Redis => Boolean(connection))
        .map((connection) => connection.quit().catch(() => undefined)),
    );
  }

  /**
   * 명령용 연결. 연결이 끊긴 동안 명령이 쌓이지 않고 바로 실패해야 요청이 오래 붙잡히지 않아서
   * 오프라인 대기열을 껐다. 그 대신 처음 만든 직후에는 연결이 준비될 때까지 기다려야 첫 명령이 실패하지 않는다
   */
  private async readyClient(): Promise<Redis> {
    if (!this.client) {
      this.client = this.connect({
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      });
    }
    const client = this.client;
    if (client.status === 'ready') return client;
    if (client.status !== 'connecting' && client.status !== 'connect') {
      throw new Error(`Valkey is not ready (${client.status})`);
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Valkey connection timed out'));
      }, CONNECT_WAIT_MS);
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new Error('Valkey connection closed'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        client.off('ready', onReady);
        client.off('close', onClose);
      };
      client.once('ready', onReady);
      client.once('close', onClose);
    });
    return client;
  }

  private connect(extra: Record<string, unknown>): Redis {
    if (!this.options) throw new Error('VALKEY_HOST is not set');
    const connection = new Redis({
      host: this.options.host,
      port: this.options.port,
      password: this.options.password,
      connectTimeout: 3000,
      ...extra,
    });
    // 연결 오류를 처리하지 않으면 ioredis가 'Unhandled error event'를 계속 찍는다
    connection.on('error', (error: Error) =>
      this.logger.warn(`Valkey connection error: ${error.message}`),
    );
    return connection;
  }
}
