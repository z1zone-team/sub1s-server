import { HttpStatus, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../../common/exceptions/business.exception';
import { VoiceJobData } from '../../domain/voice/models/voice-job';
import { SttQueueClient } from '../../infra/queue/stt-queue.client';
import { ValkeyService } from '../../infra/queue/valkey.service';
import {
  VoicePipelineJob,
  VoicePipelineQueue,
} from '../../infra/queue/voice-pipeline.queue';
import { VoiceRouteRecommendResponseDto } from './dto';
import {
  activeVoiceJobKey,
  VOICE_WAITING_SLOTS_KEY,
} from './voice-job.service';
import { VoicePipelineProcessor } from './voice-pipeline.processor';
import { VoiceResultNotifier } from './voice-result.notifier';
import { VoiceService } from './voice.service';

const RECOMMENDATION = {
  transcript: '강남에서 사당까지',
  interpretedIntent: {
    originStationName: '강남',
    destStationName: '사당',
    preferredMode: 'OPTIMAL',
    reason: '최적',
  },
  recommendedRoute: { mode: 'OPTIMAL' },
  briefingText: '안내합니다',
};

describe('VoicePipelineProcessor', () => {
  let queue: { enabled: boolean; startWorker: jest.Mock };
  let sttQueue: { transcribe: jest.Mock };
  let voiceService: { recommendFromTranscript: jest.Mock };
  let notifier: { sendResult: jest.Mock; sendFailed: jest.Mock };
  let valkey: { delete: jest.Mock; releaseSlot: jest.Mock };

  const jobWith = (
    overrides: Partial<VoiceJobData> = {},
    id = 'job-1',
  ): VoicePipelineJob & { updateData: jest.Mock } => {
    const data: VoiceJobData = {
      userId: 'user-1',
      filename: 'q.m4a',
      audioBase64: Buffer.from('voice-bytes').toString('base64'),
      options: { preferredMode: 'OPTIMAL', lat: 37.5, lng: 127 },
      submittedAt: '2026-10-12T12:00:00.000Z',
      ...overrides,
    };
    return {
      id,
      data,
      updateData: jest.fn().mockResolvedValue(undefined),
    } as unknown as VoicePipelineJob & { updateData: jest.Mock };
  };

  const make = (env: Record<string, string> = {}) =>
    new VoicePipelineProcessor(
      queue as unknown as VoicePipelineQueue,
      sttQueue as unknown as SttQueueClient,
      voiceService as unknown as VoiceService,
      notifier as unknown as VoiceResultNotifier,
      valkey as unknown as ValkeyService,
      { get: (key: string) => env[key] } as unknown as ConfigService,
    );

  beforeEach(() => {
    queue = { enabled: true, startWorker: jest.fn() };
    sttQueue = {
      transcribe: jest
        .fn()
        .mockResolvedValue({ transcript: '강남에서 사당까지' }),
    };
    voiceService = {
      recommendFromTranscript: jest.fn().mockResolvedValue(RECOMMENDATION),
    };
    notifier = { sendResult: jest.fn(), sendFailed: jest.fn() };
    valkey = {
      delete: jest.fn().mockResolvedValue(undefined),
      releaseSlot: jest.fn().mockResolvedValue(undefined),
    };
  });

  describe('onModuleInit', () => {
    it('큐를 쓸 수 있으면 워커를 시작한다', () => {
      make().onModuleInit();

      expect(queue.startWorker).toHaveBeenCalledTimes(1);
    });

    it('큐를 쓸 수 없으면 워커를 시작하지 않는다', () => {
      queue.enabled = false;

      make().onModuleInit();

      expect(queue.startWorker).not.toHaveBeenCalled();
    });

    it('워커가 받은 작업은 process로 처리한다', async () => {
      const processor = make();
      processor.onModuleInit();
      const handler = queue.startWorker.mock.calls[0][0] as (
        job: VoicePipelineJob,
      ) => Promise<unknown>;

      await expect(handler(jobWith())).resolves.toEqual({
        ok: true,
        result: RECOMMENDATION,
      });
    });
  });

  describe('완료 알림', () => {
    it('워커가 완료를 기록하면 성공 결과를 요청한 사용자에게 보낸다', () => {
      const processor = make();
      processor.onModuleInit();
      const onCompleted = queue.startWorker.mock.calls[0][1] as (
        job: VoicePipelineJob,
        outcome: unknown,
      ) => void;

      onCompleted(jobWith(), { ok: true, result: RECOMMENDATION });

      expect(notifier.sendResult).toHaveBeenCalledWith(
        'user-1',
        'job-1',
        RECOMMENDATION,
      );
      expect(notifier.sendFailed).not.toHaveBeenCalled();
    });

    it('실패 결과는 voice_failed로 같은 오류를 보낸다', () => {
      const error = {
        code: 'HTTP_ERROR',
        message: "도착역 '없는역'을(를) 찾을 수 없습니다.",
        status: 404,
      };

      make().notify('user-1', 'job-1', { ok: false, error });

      expect(notifier.sendFailed).toHaveBeenCalledWith(
        'user-1',
        'job-1',
        error,
      );
      expect(notifier.sendResult).not.toHaveBeenCalled();
    });

    it('알림이 실패해도 던지지 않는다 (결과는 GET으로 조회할 수 있다)', () => {
      notifier.sendResult.mockImplementation(() => {
        throw new Error('socket closed');
      });

      expect(() =>
        make().notify('user-1', 'job-1', {
          ok: true,
          result: RECOMMENDATION as unknown as VoiceRouteRecommendResponseDto,
        }),
      ).not.toThrow();
    });
  });

  describe('process', () => {
    it('AI 큐에서 전사하고 결과를 만든다', async () => {
      const job = jobWith();

      const outcome = await make().process(job);

      expect(outcome).toEqual({ ok: true, result: RECOMMENDATION });
      expect(sttQueue.transcribe).toHaveBeenCalledWith(
        Buffer.from('voice-bytes'),
      );
      expect(voiceService.recommendFromTranscript).toHaveBeenCalledWith(
        'user-1',
        '강남에서 사당까지',
        { preferredMode: 'OPTIMAL', lat: 37.5, lng: 127 },
        undefined,
      );
      // 알림은 작업이 완료로 기록된 뒤(완료 훅)에 보내므로 process 안에서는 보내지 않는다
      expect(notifier.sendResult).not.toHaveBeenCalled();
      expect(notifier.sendFailed).not.toHaveBeenCalled();
    });

    it('전사가 끝나면 큐에서 오디오를 비운다', async () => {
      const job = jobWith();

      await make().process(job);

      expect(job.updateData).toHaveBeenCalledWith(
        expect.objectContaining({ audioBase64: '', userId: 'user-1' }),
      );
    });

    it('전사가 실패해도 큐에서 원본 오디오를 비운다', async () => {
      sttQueue.transcribe.mockRejectedValue(new Error('stt down'));
      const job = jobWith();

      await expect(make().process(job)).resolves.toMatchObject({ ok: false });

      expect(job.updateData).toHaveBeenCalledWith(
        expect.objectContaining({ audioBase64: '' }),
      );
    });

    it('처리를 시작하면 대기 자리를 돌려준다', async () => {
      await make().process(jobWith());

      expect(valkey.releaseSlot).toHaveBeenCalledWith(VOICE_WAITING_SLOTS_KEY);
    });

    it('끝나면 진행 중 표시를 지운다', async () => {
      await make().process(jobWith());

      expect(valkey.delete).toHaveBeenCalledWith(activeVoiceJobKey('user-1'));
    });

    it('텍스트 힌트가 있으면 AI 큐를 부르지 않는다', async () => {
      const job = jobWith({
        options: { transcriptHint: '  홍대에서 신촌까지  ' },
      });

      await make().process(job);

      expect(sttQueue.transcribe).not.toHaveBeenCalled();
      expect(voiceService.recommendFromTranscript).toHaveBeenCalledWith(
        'user-1',
        '홍대에서 신촌까지',
        { transcriptHint: '  홍대에서 신촌까지  ' },
        undefined,
      );
    });

    it('Gemini가 음성 인식과 함께 준 의도 힌트를 넘긴다', async () => {
      sttQueue.transcribe.mockResolvedValue({
        transcript: '신도림역에서 왕십리역까지 덜 붐비는 길',
        provider: 'gemini',
        intent: {
          origin: '신도림',
          destination: '왕십리',
          mode: 'COMFORTABLE',
        },
      });

      await make().process(jobWith());

      expect(voiceService.recommendFromTranscript).toHaveBeenCalledWith(
        'user-1',
        '신도림역에서 왕십리역까지 덜 붐비는 길',
        { preferredMode: 'OPTIMAL', lat: 37.5, lng: 127 },
        { origin: '신도림', destination: '왕십리', mode: 'COMFORTABLE' },
      );
    });

    it('역을 찾지 못하는 업무 오류는 작업을 실패시키지 않고 ok false 결과로 알린다', async () => {
      voiceService.recommendFromTranscript.mockRejectedValue(
        new NotFoundException(
          "도착역 '없는역'을(를) 지하철 노선망에서 찾을 수 없습니다.",
        ),
      );

      const outcome = await make().process(jobWith());

      expect(outcome).toEqual({
        ok: false,
        error: {
          code: 'HTTP_ERROR',
          message: "도착역 '없는역'을(를) 지하철 노선망에서 찾을 수 없습니다.",
          status: 404,
        },
      });
      expect(valkey.delete).toHaveBeenCalledWith(activeVoiceJobKey('user-1'));
    });

    it('업무 오류 코드와 상태를 HTTP 응답과 같게 보존한다', async () => {
      voiceService.recommendFromTranscript.mockRejectedValue(
        new BusinessException(
          'VOICE_ORIGIN_REQUIRED',
          '출발지를 말씀해 주시거나 현재 위치를 켜 주세요.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
      );

      const outcome = await make().process(jobWith());

      expect(outcome).toEqual({
        ok: false,
        error: {
          code: 'VOICE_ORIGIN_REQUIRED',
          message: '출발지를 말씀해 주시거나 현재 위치를 켜 주세요.',
          status: 422,
        },
      });
    });

    it('AI 음성 인식을 쓸 수 없으면 503 AI_SERVICE_UNAVAILABLE로 알린다', async () => {
      sttQueue.transcribe.mockRejectedValue(
        new BusinessException(
          'AI_SERVICE_UNAVAILABLE',
          '음성 인식을 사용할 수 없어요.',
          HttpStatus.SERVICE_UNAVAILABLE,
        ),
      );

      const outcome = await make().process(jobWith());

      expect(outcome).toMatchObject({
        ok: false,
        error: { code: 'AI_SERVICE_UNAVAILABLE', status: 503 },
      });
      expect(voiceService.recommendFromTranscript).not.toHaveBeenCalled();
    });

    it('예상하지 못한 오류는 내부 내용을 숨기고 500으로 알린다', async () => {
      voiceService.recommendFromTranscript.mockRejectedValue(
        new Error('prisma: connection string postgres://secret'),
      );

      const outcome = await make().process(jobWith());

      expect(outcome).toEqual({
        ok: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: '서버 내부 오류가 발생했습니다.',
          status: 500,
        },
      });
    });

    it('시간 안에 끝나지 않으면 504 VOICE_JOB_TIMEOUT으로 알린다', async () => {
      sttQueue.transcribe.mockReturnValue(new Promise(() => undefined));

      const outcome = await make({ VOICE_JOB_TIMEOUT_MS: '30' }).process(
        jobWith(),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: { code: 'VOICE_JOB_TIMEOUT', status: 504 },
      });
      expect(valkey.delete).toHaveBeenCalledWith(activeVoiceJobKey('user-1'));
    });

    it('진행 중 표시를 지우다 실패해도 결과는 그대로 돌려준다', async () => {
      valkey.delete.mockRejectedValue(new Error('connection closed'));

      await expect(make().process(jobWith())).resolves.toEqual({
        ok: true,
        result: RECOMMENDATION,
      });
    });

    it('오디오를 비우는 데 실패해도 처리는 계속한다', async () => {
      const job = jobWith();
      job.updateData.mockRejectedValue(new Error('job gone'));

      await expect(make().process(job)).resolves.toMatchObject({ ok: true });
    });
  });
});
