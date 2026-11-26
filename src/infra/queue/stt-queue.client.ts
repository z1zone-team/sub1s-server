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

/** Gemini가 음성 인식과 함께 준 의도 힌트. 서버가 규칙과 역 사전으로 다시 확인한다 */
export interface VoiceIntentHint {
  origin?: string;
  destination?: string;
  mode?: string;
}

export interface QueuedSttResult {
  transcript: string;
  durationSec?: number;
  /** 받아 적은 제공자(`gemini`, `whisper`). 예전 AI 서버는 주지 않는다 */
  provider?: string;
  intent?: VoiceIntentHint;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** AI 결과의 `intent`를 읽는다. 모양이 다르면 버린다(힌트일 뿐이라 없어도 처리는 계속된다) */
export function parseIntentHint(value: unknown): VoiceIntentHint | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const hint: VoiceIntentHint = {
    origin: text(raw.origin),
    destination: text(raw.destination),
    mode: text(raw.mode),
  };
  return hint.origin || hint.destination || hint.mode ? hint : undefined;
}

const DEFAULT_AI_QUEUE = 'subway-voice';
const DEFAULT_STT_TIMEOUT_MS = 25000;
/** 완료 이벤트를 놓쳤을 때를 대비해 작업 상태를 확인하는 간격 */
const POLL_INTERVAL_MS = 1000;

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
    this.queueName = config.get<string>('VOICE_QUEUE_NAME') ?? DEFAULT_AI_QUEUE;
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
      result = await this.waitForResult(queue, job, events);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`STT queue job ${jobId ?? '-'} failed: ${message}`);
      if (jobId) await this.discard(queue, jobId);
      throw this.unavailable();
    }
    return this.parse(result);
  }

  /**
   * 작업이 끝나기를 기다린다. 완료 이벤트(QueueEvents)를 기다리면서, 이벤트를 놓쳐도 끝난 작업을
   * 찾도록 주기적으로 작업 상태도 확인한다. QueueEvents는 연결 직후 읽기를 시작하기 전에 일어난 이벤트를
   * 못 받을 수 있어서(CI에서 AI 큐 작업은 completed인데 서버가 계속 기다린 사례, 서버 이슈 #154)
   * 이벤트만 믿으면 제한 시간까지 멈춘다
   */
  private waitForResult(
    queue: Queue,
    job: Awaited<ReturnType<Queue['add']>>,
    events: QueueEvents,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const settle =
        <T>(finish: (value: T) => void) =>
        (value: T) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          finish(value);
        };
      const ok = settle(resolve);
      const fail = settle(reject);

      job.waitUntilFinished(events, this.timeoutMs).then(ok, fail);

      const poll = async (): Promise<void> => {
        if (settled) return;
        try {
          const current = job.id ? await queue.getJob(job.id) : undefined;
          const state = await current?.getState();
          if (state === 'completed') {
            ok(current?.returnvalue);
            return;
          }
          if (state === 'failed') {
            fail(new Error(current?.failedReason ?? 'STT job failed'));
            return;
          }
        } catch {
          // 이번 확인이 실패해도 이벤트 대기나 다음 확인이 이어 간다
        }
        if (!settled) timer = setTimeout(poll, POLL_INTERVAL_MS);
      };
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.events?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  private parse(result: unknown): QueuedSttResult {
    const body = result as {
      transcript?: unknown;
      durationSec?: unknown;
      provider?: unknown;
      intent?: unknown;
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
      provider: text(body.provider),
      intent: parseIntentHint(body.intent),
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
