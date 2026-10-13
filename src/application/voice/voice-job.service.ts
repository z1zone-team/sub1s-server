import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../../common/exceptions/business.exception';
import { kstNowIso } from '../../common/utils/kst';
import {
  VoiceJobError,
  VoiceJobOutcome,
} from '../../domain/voice/models/voice-job';
import { ValkeyService } from '../../infra/queue/valkey.service';
import {
  VoicePipelineJob,
  VoicePipelineQueue,
} from '../../infra/queue/voice-pipeline.queue';
import {
  VoiceJobStatusResponseDto,
  VoiceJobSubmitResponseDto,
  VoiceRouteRecommendRequestDto,
  VoiceRouteRecommendResponseDto,
} from './dto';
import { UploadedAudioFile, VoiceService } from './voice.service';

/** 큐에 담는 오디오 상한. 오디오는 base64로 Valkey 메모리(운영 80MB)에 올라간다 */
export const DEFAULT_VOICE_JOB_MAX_AUDIO_BYTES = 2 * 1024 * 1024;
/** 대기 중인 작업이 이만큼 쌓이면 새 요청을 받지 않는다 */
export const DEFAULT_VOICE_QUEUE_MAX_WAITING = 10;
/** 사용자당 진행 중 작업 표시의 유효 시간. 작업이 끝나면 바로 지운다 */
const ACTIVE_GUARD_TTL_SEC = 120;

export const activeVoiceJobKey = (userId: string): string =>
  `voice:active:${userId}`;

@Injectable()
export class VoiceJobService {
  private readonly logger = new Logger(VoiceJobService.name);
  private readonly maxAudioBytes: number;
  private readonly maxWaiting: number;

  constructor(
    private readonly voiceService: VoiceService,
    private readonly queue: VoicePipelineQueue,
    private readonly valkey: ValkeyService,
    config: ConfigService,
  ) {
    this.maxAudioBytes = Number(
      config.get<string>('VOICE_ASYNC_MAX_AUDIO_BYTES') ??
        DEFAULT_VOICE_JOB_MAX_AUDIO_BYTES,
    );
    this.maxWaiting = Number(
      config.get<string>('VOICE_QUEUE_MAX_WAITING') ??
        DEFAULT_VOICE_QUEUE_MAX_WAITING,
    );
  }

  /**
   * 음성 요청을 큐에 넣고 작업 ID를 돌려준다. 결과는 WebSocket(`voice_result`, `voice_failed`)으로 가고
   * 놓쳤으면 `getStatus`로 조회한다.
   */
  async submit(
    userId: string,
    file: UploadedAudioFile | undefined,
    dto: VoiceRouteRecommendRequestDto,
  ): Promise<VoiceJobSubmitResponseDto> {
    if (!this.queue.enabled) throw this.queueUnavailable();

    this.voiceService.validateAudioFile(file);
    if (file!.buffer.length > this.maxAudioBytes) {
      throw new BusinessException(
        'VOICE_AUDIO_TOO_LARGE',
        `오디오 파일 크기는 최대 ${Math.floor(this.maxAudioBytes / 1024 / 1024)}MB까지 가능합니다.`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const guardKey = activeVoiceJobKey(userId);
    let acquired: boolean;
    try {
      acquired = await this.valkey.setIfAbsent(guardKey, ACTIVE_GUARD_TTL_SEC);
    } catch (error: unknown) {
      this.logQueueError('guard', error);
      throw this.queueUnavailable();
    }
    if (!acquired) {
      throw new HttpException(
        {
          code: 'VOICE_JOB_IN_PROGRESS',
          message: '이전 음성 요청을 처리 중입니다. 잠시만 기다려주세요.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      if ((await this.queue.waitingCount()) >= this.maxWaiting) {
        throw new BusinessException(
          'VOICE_QUEUE_FULL',
          '지금 음성 요청이 많아요. 잠시 후 다시 시도해 주세요.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      const jobId = await this.queue.add({
        userId,
        filename: file!.originalname,
        audioBase64: file!.buffer.toString('base64'),
        options: {
          preferredMode: dto?.preferredMode,
          transcriptHint: dto?.transcriptHint,
          lat: dto?.lat,
          lng: dto?.lng,
        },
        submittedAt: kstNowIso(),
      });
      return { jobId, status: 'QUEUED' };
    } catch (error: unknown) {
      // 큐에 넣지 못했으면 사용자가 바로 다시 시도할 수 있게 표시를 지운다
      await this.valkey.delete(guardKey).catch(() => undefined);
      if (error instanceof BusinessException) throw error;
      this.logQueueError('enqueue', error);
      throw this.queueUnavailable();
    }
  }

  /** 본인의 작업 상태와 결과. 다른 사용자의 작업이나 없는(보관 기간이 지난) 작업은 404 */
  async getStatus(
    userId: string,
    jobId: string,
  ): Promise<VoiceJobStatusResponseDto> {
    if (!this.queue.enabled) throw this.queueUnavailable();

    let job: VoicePipelineJob | undefined;
    try {
      job = await this.queue.getJob(jobId);
    } catch (error: unknown) {
      this.logQueueError('lookup', error);
      throw this.queueUnavailable();
    }
    if (!job || job.data.userId !== userId) {
      throw new NotFoundException({
        code: 'VOICE_JOB_NOT_FOUND',
        message: '음성 요청을 찾을 수 없어요. 보관 기간이 지났을 수 있어요.',
      });
    }

    const state = await job.getState();
    if (state === 'completed') {
      // 작업을 읽은 뒤 상태를 읽기 전에 끝났다면 메모리의 `returnvalue`는 진행 중일 때의 빈 값이다.
      // 끝난 것이 확인됐으니 다시 읽어 최신 결과를 쓴다(그렇지 않으면 성공한 작업이 실패로 보인다)
      const finished = await this.refetchFinished(job, jobId);
      const outcome = finished.returnvalue as
        | VoiceJobOutcome<VoiceRouteRecommendResponseDto>
        | undefined;
      if (outcome?.ok) {
        return { jobId, status: 'COMPLETED', result: outcome.result };
      }
      return {
        jobId,
        status: 'FAILED',
        error: outcome?.ok === false ? outcome.error : this.unknownFailure(),
      };
    }
    if (state === 'failed') {
      return { jobId, status: 'FAILED', error: this.unknownFailure() };
    }
    return { jobId, status: state === 'active' ? 'PROCESSING' : 'QUEUED' };
  }

  /** 끝난 작업의 결과를 최신 상태로 읽는다. 이미 결과가 있으면 다시 읽지 않고, 다시 읽지 못하면 있는 값을 쓴다 */
  private async refetchFinished(
    job: VoicePipelineJob,
    jobId: string,
  ): Promise<Pick<VoicePipelineJob, 'returnvalue'>> {
    if (job.returnvalue !== undefined && job.returnvalue !== null) return job;
    try {
      return (await this.queue.getJob(jobId)) ?? job;
    } catch (error: unknown) {
      this.logQueueError('lookup', error);
      return job;
    }
  }

  private unknownFailure(): VoiceJobError {
    return {
      code: 'VOICE_JOB_FAILED',
      message: '음성 요청을 처리하지 못했어요. 다시 시도해 주세요.',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }

  private queueUnavailable(): BusinessException {
    return new BusinessException(
      'VOICE_QUEUE_UNAVAILABLE',
      '지금은 음성 요청을 받을 수 없어요. 잠시 후 다시 시도해 주세요.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private logQueueError(step: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Voice queue ${step} failed: ${message}`);
  }
}
