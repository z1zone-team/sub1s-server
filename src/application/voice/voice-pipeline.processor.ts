import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../../common/exceptions/business.exception';
import { toErrorInfo } from '../../common/utils/error-info';
import {
  VoiceJobError,
  VoiceJobOutcome,
} from '../../domain/voice/models/voice-job';
import { SttQueueClient } from '../../infra/queue/stt-queue.client';
import { ValkeyService } from '../../infra/queue/valkey.service';
import {
  VoicePipelineJob,
  VoicePipelineQueue,
} from '../../infra/queue/voice-pipeline.queue';
import { VoiceResultDto } from './dto';
import { activeVoiceJobKey } from './voice-job.service';
import { VoiceResultNotifier } from './voice-result.notifier';
import { VoiceService } from './voice.service';

/** 작업 하나가 이 시간 안에 끝나지 않으면 실패로 알린다 (STT 대기 25초 + 경로 탐색 여유) */
export const DEFAULT_VOICE_JOB_TIMEOUT_MS = 35000;

/**
 * `voice-route` 큐 작업을 처리하는 서버 워커. 무거운 STT는 AI 워커(`subway-voice` 큐)에 맡기고
 * 전사문을 받아 의도 분석, 경로 탐색, 브리핑을 이어서 처리한 뒤 사용자에게 결과를 알린다.
 * 경로 탐색과 개인화는 그래프와 DB가 있는 서버에서만 할 수 있어 서버가 오케스트레이션한다.
 */
@Injectable()
export class VoicePipelineProcessor implements OnModuleInit {
  private readonly logger = new Logger(VoicePipelineProcessor.name);
  private readonly timeoutMs: number;

  constructor(
    private readonly queue: VoicePipelineQueue,
    private readonly sttQueue: SttQueueClient,
    private readonly voiceService: VoiceService,
    private readonly notifier: VoiceResultNotifier,
    private readonly valkey: ValkeyService,
    config: ConfigService,
  ) {
    this.timeoutMs = Number(
      config.get<string>('VOICE_JOB_TIMEOUT_MS') ?? DEFAULT_VOICE_JOB_TIMEOUT_MS,
    );
  }

  onModuleInit(): void {
    if (!this.queue.enabled) {
      this.logger.log('VALKEY_HOST is not set: voice job worker is disabled');
      return;
    }
    // 알림은 작업이 완료로 기록된 뒤에 보낸다. 이벤트를 받은 클라이언트가 바로 GET으로 조회해도 결과가 보이도록
    this.queue.startWorker(
      (job) => this.process(job),
      (job, outcome) =>
        this.notify(
          job.data.userId,
          job.id ?? '',
          outcome as VoiceJobOutcome<VoiceResultDto>,
        ),
    );
  }

  /** 작업 하나를 처리한다. 업무 오류는 던지지 않고 `ok: false` 결과로 돌려준다 */
  async process(
    job: VoicePipelineJob,
  ): Promise<VoiceJobOutcome<VoiceResultDto>> {
    const { userId } = job.data;
    const jobId = job.id ?? '';

    let outcome: VoiceJobOutcome<VoiceResultDto>;
    try {
      const result = await this.withTimeout(this.run(job));
      outcome = { ok: true, result };
    } catch (error: unknown) {
      const info = toErrorInfo(error);
      if (info.unexpected) {
        this.logger.error(`Voice job ${jobId} crashed`, error as Error);
      }
      const failure: VoiceJobError = {
        code: info.code,
        message: info.message,
        status: info.status,
      };
      outcome = { ok: false, error: failure };
    } finally {
      // 같은 사용자가 바로 다시 말할 수 있게 진행 중 표시를 지운다
      await this.valkey
        .delete(activeVoiceJobKey(userId))
        .catch(() => undefined);
    }

    return outcome;
  }

  /** 결과를 요청한 사용자에게 알린다. 알림이 실패해도 결과는 작업에 남아 있어 GET으로 조회할 수 있다 */
  notify(
    userId: string,
    jobId: string,
    outcome: VoiceJobOutcome<VoiceResultDto>,
  ): void {
    try {
      if (outcome.ok) this.notifier.sendResult(userId, jobId, outcome.result);
      else this.notifier.sendFailed(userId, jobId, outcome.error);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Voice job ${jobId} notify failed: ${message}`);
    }
  }

  private async run(
    job: VoicePipelineJob,
  ): Promise<VoiceResultDto> {
    const data = job.data;
    const hint = data.options.transcriptHint?.trim();

    const transcript = hint
      ? hint
      : (await this.sttQueue.transcribe(Buffer.from(data.audioBase64, 'base64')))
          .transcript;

    // 전사가 끝났으니 오디오는 큐(Valkey 메모리)에서 비운다
    await job
      .updateData({ ...data, audioBase64: '' })
      .catch(() => undefined);

    return this.voiceService.recommendFromTranscript(
      data.userId,
      transcript,
      data.options,
    );
  }

  /** 시간 안에 끝나지 않으면 `VOICE_JOB_TIMEOUT`(504)으로 알린다. 늦게 끝난 결과는 버린다 */
  private withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new BusinessException(
              'VOICE_JOB_TIMEOUT',
              '음성 처리가 오래 걸리고 있어요. 다시 시도해 주세요.',
              HttpStatus.GATEWAY_TIMEOUT,
            ),
          ),
        this.timeoutMs,
      );
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }
}
