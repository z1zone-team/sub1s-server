import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import {
  VoiceJobData,
  VoiceJobOutcome,
} from '../../domain/voice/models/voice-job';
import { ValkeyService } from './valkey.service';

export type VoicePipelineJob = Job<VoiceJobData, VoiceJobOutcome<unknown>>;
export type VoicePipelineHandler = (
  job: VoicePipelineJob,
) => Promise<VoiceJobOutcome<unknown>>;
/** 작업이 완료로 기록된 뒤에 불린다. 이 시점에는 `GET`으로 결과를 조회할 수 있다 */
export type VoicePipelineCompleted = (
  job: VoicePipelineJob,
  outcome: VoiceJobOutcome<unknown>,
) => void;

const DEFAULT_QUEUE = 'voice-route';
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_RETENTION_SEC = 600;
/** 작업 하나가 길어도 BullMQ가 멈춘 작업으로 오해하지 않도록 잠금을 넉넉히 잡는다 */
const LOCK_DURATION_MS = 60000;

/**
 * 음성 경로 추천 작업(`voice-route` 큐)의 대기열과 서버 워커.
 * 오디오를 받은 요청은 여기에 작업만 넣고 바로 응답하고, 워커가 STT부터 브리핑까지 이어서 처리한다
 */
@Injectable()
export class VoicePipelineQueue implements OnModuleDestroy {
  private readonly logger = new Logger(VoicePipelineQueue.name);
  private readonly queueName: string;
  private readonly concurrency: number;
  private readonly retentionSec: number;
  private queue?: Queue<VoiceJobData, VoiceJobOutcome<unknown>>;
  private worker?: Worker<VoiceJobData, VoiceJobOutcome<unknown>>;

  constructor(
    private readonly valkey: ValkeyService,
    config: ConfigService,
  ) {
    this.queueName =
      config.get<string>('VOICE_PIPELINE_QUEUE_NAME') ?? DEFAULT_QUEUE;
    this.concurrency = Math.max(
      1,
      Number(
        config.get<string>('VOICE_PIPELINE_CONCURRENCY') ?? DEFAULT_CONCURRENCY,
      ),
    );
    this.retentionSec = Number(
      config.get<string>('VOICE_JOB_RETENTION_SEC') ?? DEFAULT_RETENTION_SEC,
    );
  }

  get enabled(): boolean {
    return this.valkey.enabled;
  }

  /** 작업을 넣고 작업 ID를 돌려준다. ID는 추측할 수 없도록 UUID다 */
  async add(data: VoiceJobData): Promise<string> {
    const jobId = randomUUID();
    await this.ensureQueue().add('voice-route', data, {
      jobId,
      attempts: 1,
      removeOnComplete: { age: this.retentionSec },
      removeOnFail: { age: this.retentionSec },
    });
    return jobId;
  }

  async waitingCount(): Promise<number> {
    return this.ensureQueue().getWaitingCount();
  }

  async getJob(jobId: string): Promise<VoicePipelineJob | undefined> {
    return this.ensureQueue().getJob(jobId);
  }

  /** 서버 워커를 시작한다. 이미 시작했으면 아무것도 하지 않는다 */
  startWorker(
    handler: VoicePipelineHandler,
    onCompleted?: VoicePipelineCompleted,
  ): void {
    if (this.worker || !this.valkey.options) return;
    this.worker = new Worker<VoiceJobData, VoiceJobOutcome<unknown>>(
      this.queueName,
      handler,
      {
        connection: this.valkey.createConnection(true),
        concurrency: this.concurrency,
        lockDuration: LOCK_DURATION_MS,
      },
    );
    this.worker.on('error', (error) =>
      this.logger.warn(`Voice worker error: ${error.message}`),
    );
    if (onCompleted) {
      this.worker.on('completed', (job, outcome) => {
        try {
          onCompleted(job, outcome);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(`Voice job ${job.id} completion hook: ${message}`);
        }
      });
    }
    this.worker.on('failed', (job, error) =>
      this.logger.warn(`Voice job ${job?.id ?? '-'} failed: ${error.message}`),
    );
    this.logger.log(
      `Voice pipeline worker started (queue=${this.queueName}, concurrency=${this.concurrency})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  private ensureQueue(): Queue<VoiceJobData, VoiceJobOutcome<unknown>> {
    if (!this.valkey.options) throw new Error('VALKEY_HOST is not set');
    if (!this.queue) {
      this.queue = new Queue<VoiceJobData, VoiceJobOutcome<unknown>>(
        this.queueName,
        { connection: this.valkey.createConnection() },
      );
      this.queue.on('error', (error) =>
        this.logger.warn(`Voice queue error: ${error.message}`),
      );
    }
    return this.queue;
  }
}
