import {
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ValkeyService } from './valkey.service';

export interface QueuedSttResult {
  transcript: string;
  durationSec?: number;
}

const DEFAULT_AI_QUEUE = 'subway-voice';
const DEFAULT_STT_TIMEOUT_MS = 25000;

/**
 * AI 서비스(Python 워커)의 `subway-voice` 큐에 `stt` 작업을 넣고 전사 결과를 기다린다.
 * 작업 형식은 sub1s-ai README의 "BullMQ 작업 형식"을 따른다
 */
@Injectable()
export class SttQueueClient implements OnModuleDestroy {
  private readonly logger = new Logger(SttQueueClient.name);
  private readonly queueName: string;
  private readonly timeoutMs: number;
  private queue?: Queue;
  private events?: QueueEvents;

  constructor(
    private readonly valkey: ValkeyService,
    config: ConfigService,
  ) {
    this.queueName =
      config.get<string>('VOICE_QUEUE_NAME') ?? DEFAULT_AI_QUEUE;
    this.timeoutMs = Number(
      config.get<string>('VOICE_STT_TIMEOUT_MS') ?? DEFAULT_STT_TIMEOUT_MS,
    );
  }

  /**
   * 오디오를 전사한다. AI 워커가 없거나 시간 안에 끝나지 않거나 결과 형식이 다르면 503이다.
   * 말소리가 없어 전사문이 비면 `VOICE_NO_SPEECH`(422)이다(AI 고장이 아니라 다시 말하면 되는 경우).
   * 오디오는 큐(Valkey 메모리)에 base64로 담기므로 끝난 작업은 짧게만 보관한다
   */
  async transcribe(audio: Buffer): Promise<QueuedSttResult> {
    const { queue, events } = this.ensureQueue();
    let jobId: string | undefined;
    let result: unknown;
    try {
      const job = await queue.add(
        'stt',
        { action: 'stt', audioBase64: audio.toString('base64') },
        {
          attempts: 1,
          removeOnComplete: { age: 30, count: 50 },
          removeOnFail: { age: 60, count: 50 },
        },
      );
      jobId = job.id;
      result = await job.waitUntilFinished(events, this.timeoutMs);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`STT queue job ${jobId ?? '-'} failed: ${message}`);
      if (jobId) await this.discard(queue, jobId);
      throw this.unavailable();
    }
    return this.parse(result);
  }

  async onModuleDestroy(): Promise<void> {
    await this.events?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  private parse(result: unknown): QueuedSttResult {
    const body = result as {
      transcript?: unknown;
      durationSec?: unknown;
      error?: unknown;
    } | null;
    if (!body || body.error || typeof body.transcript !== 'string') {
      this.logger.warn(
        `unexpected STT result: ${JSON.stringify(body)?.slice(0, 120)}`,
      );
      throw this.unavailable();
    }
    const transcript = body.transcript.trim();
    if (!transcript) throw this.noSpeech();
    return {
      transcript,
      durationSec:
        typeof body.durationSec === 'number' ? body.durationSec : undefined,
    };
  }

  /** 기다리다 포기한 작업이 아직 대기 중이면 지워서 큐에 오디오가 남지 않게 한다 */
  private async discard(queue: Queue, jobId: string): Promise<void> {
    try {
      const job = await queue.getJob(jobId);
      if (job && (await job.isWaiting())) await job.remove();
    } catch {
      // 이미 처리 중이거나 끝난 작업이면 남겨 둔다(보관 기간이 지나면 지워진다)
    }
  }

  private ensureQueue(): { queue: Queue; events: QueueEvents } {
    if (!this.valkey.options) throw this.unavailable();
    if (!this.queue || !this.events) {
      this.queue = new Queue(this.queueName, {
        connection: this.valkey.createConnection(),
      });
      this.events = new QueueEvents(this.queueName, {
        connection: this.valkey.createConnection(true),
      });
      this.queue.on('error', (e) =>
        this.logger.warn(`STT queue error: ${e.message}`),
      );
      this.events.on('error', (e) =>
        this.logger.warn(`STT events error: ${e.message}`),
      );
    }
    return { queue: this.queue, events: this.events };
  }

  private noSpeech(): BusinessException {
    return new BusinessException(
      'VOICE_NO_SPEECH',
      '말소리가 잘 들리지 않았어요. 조용한 곳에서 역 이름을 또박또박 말씀해 주세요.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private unavailable(): BusinessException {
    return new BusinessException(
      'AI_SERVICE_UNAVAILABLE',
      '음성 인식을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
