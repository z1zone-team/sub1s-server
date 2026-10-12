import { HttpStatus, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceJobData } from '../../domain/voice/models/voice-job';
import { ValkeyService } from '../../infra/queue/valkey.service';
import { VoicePipelineQueue } from '../../infra/queue/voice-pipeline.queue';
import {
  activeVoiceJobKey,
  DEFAULT_VOICE_JOB_MAX_AUDIO_BYTES,
  VoiceJobService,
} from './voice-job.service';
import { UploadedAudioFile, VoiceService } from './voice.service';

const audioFile = (bytes = 100): UploadedAudioFile => ({
  fieldname: 'file',
  originalname: 'query.m4a',
  encoding: '7bit',
  mimetype: 'audio/m4a',
  size: bytes,
  buffer: Buffer.alloc(bytes, 7),
});

describe('VoiceJobService', () => {
  let voiceService: { validateAudioFile: jest.Mock };
  let queue: {
    enabled: boolean;
    waitingCount: jest.Mock;
    add: jest.Mock;
    getJob: jest.Mock;
  };
  let valkey: { setIfAbsent: jest.Mock; delete: jest.Mock };
  let service: VoiceJobService;

  const make = (env: Record<string, string> = {}) =>
    new VoiceJobService(
      voiceService as unknown as VoiceService,
      queue as unknown as VoicePipelineQueue,
      valkey as unknown as ValkeyService,
      { get: (key: string) => env[key] } as unknown as ConfigService,
    );

  beforeEach(() => {
    voiceService = { validateAudioFile: jest.fn() };
    queue = {
      enabled: true,
      waitingCount: jest.fn().mockResolvedValue(0),
      add: jest.fn().mockResolvedValue('job-uuid'),
      getJob: jest.fn(),
    };
    valkey = {
      setIfAbsent: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = make();
  });

  describe('submit', () => {
    it('오디오를 큐에 넣고 QUEUED와 작업 ID를 돌려준다', async () => {
      const result = await service.submit('user-1', audioFile(), {
        preferredMode: 'COMFORTABLE',
        transcriptHint: '강남에서 사당',
        lat: 37.5,
        lng: 127,
      });

      expect(result).toEqual({ jobId: 'job-uuid', status: 'QUEUED' });
      const data = queue.add.mock.calls[0][0] as VoiceJobData;
      expect(data.userId).toBe('user-1');
      expect(data.filename).toBe('query.m4a');
      expect(Buffer.from(data.audioBase64, 'base64')).toHaveLength(100);
      expect(data.options).toEqual({
        preferredMode: 'COMFORTABLE',
        transcriptHint: '강남에서 사당',
        lat: 37.5,
        lng: 127,
      });
      // 진행 중 표시는 작업이 끝날 때까지 남긴다
      expect(valkey.delete).not.toHaveBeenCalled();
    });

    it('진행 중 표시를 사용자별 키로 120초 동안 건다', async () => {
      await service.submit('user-1', audioFile(), {});

      expect(valkey.setIfAbsent).toHaveBeenCalledWith(
        activeVoiceJobKey('user-1'),
        120,
      );
    });

    it('큐를 쓸 수 없으면 503 VOICE_QUEUE_UNAVAILABLE이다', async () => {
      queue.enabled = false;

      await expect(
        service.submit('user-1', audioFile(), {}),
      ).rejects.toMatchObject({
        errorCode: 'VOICE_QUEUE_UNAVAILABLE',
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('오디오 검증에 실패하면 큐에 넣지 않고 그 오류를 그대로 던진다', async () => {
      voiceService.validateAudioFile.mockImplementation(() => {
        throw new NotFoundException('invalid audio');
      });

      await expect(
        service.submit('user-1', audioFile(), {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(valkey.setIfAbsent).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('오디오가 2MB를 넘으면 413이고 진행 중 표시도 만들지 않는다', async () => {
      await expect(
        service.submit(
          'user-1',
          audioFile(DEFAULT_VOICE_JOB_MAX_AUDIO_BYTES + 1),
          {},
        ),
      ).rejects.toMatchObject({
        errorCode: 'VOICE_AUDIO_TOO_LARGE',
        status: HttpStatus.PAYLOAD_TOO_LARGE,
      });
      expect(valkey.setIfAbsent).not.toHaveBeenCalled();
    });

    it('정확히 2MB까지는 받는다', async () => {
      await expect(
        service.submit(
          'user-1',
          audioFile(DEFAULT_VOICE_JOB_MAX_AUDIO_BYTES),
          {},
        ),
      ).resolves.toMatchObject({ status: 'QUEUED' });
    });

    it('환경 변수로 오디오 상한을 바꿀 수 있다', async () => {
      service = make({ VOICE_ASYNC_MAX_AUDIO_BYTES: '50' });

      await expect(
        service.submit('user-1', audioFile(51), {}),
      ).rejects.toMatchObject({ errorCode: 'VOICE_AUDIO_TOO_LARGE' });
    });

    it('이미 진행 중인 작업이 있으면 429 VOICE_JOB_IN_PROGRESS이고 큐에 넣지 않는다', async () => {
      valkey.setIfAbsent.mockResolvedValue(false);

      await expect(
        service.submit('user-1', audioFile(), {}),
      ).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
        response: { code: 'VOICE_JOB_IN_PROGRESS' },
      });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('대기 작업이 10건이면 503 VOICE_QUEUE_FULL이고 진행 중 표시를 지운다', async () => {
      queue.waitingCount.mockResolvedValue(10);

      await expect(
        service.submit('user-1', audioFile(), {}),
      ).rejects.toMatchObject({
        errorCode: 'VOICE_QUEUE_FULL',
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
      expect(queue.add).not.toHaveBeenCalled();
      expect(valkey.delete).toHaveBeenCalledWith(activeVoiceJobKey('user-1'));
    });

    it('대기 작업이 9건이면 아직 받는다', async () => {
      queue.waitingCount.mockResolvedValue(9);

      await expect(
        service.submit('user-1', audioFile(), {}),
      ).resolves.toMatchObject({ status: 'QUEUED' });
    });

    it('큐에 넣다가 실패하면 503이고 진행 중 표시를 지워 바로 다시 시도할 수 있다', async () => {
      queue.add.mockRejectedValue(new Error('ECONNRESET'));

      await expect(
        service.submit('user-1', audioFile(), {}),
      ).rejects.toMatchObject({ errorCode: 'VOICE_QUEUE_UNAVAILABLE' });
      expect(valkey.delete).toHaveBeenCalledWith(activeVoiceJobKey('user-1'));
    });

    it('Valkey 표시를 만들지 못하면 503이다', async () => {
      valkey.setIfAbsent.mockRejectedValue(new Error('connection closed'));

      await expect(
        service.submit('user-1', audioFile(), {}),
      ).rejects.toMatchObject({ errorCode: 'VOICE_QUEUE_UNAVAILABLE' });
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    const jobIn = (state: string, extra: Record<string, unknown> = {}) => ({
      data: { userId: 'user-1' },
      getState: jest.fn().mockResolvedValue(state),
      returnvalue: undefined,
      ...extra,
    });

    it('없는 작업은 404 VOICE_JOB_NOT_FOUND이다', async () => {
      queue.getJob.mockResolvedValue(undefined);

      await expect(service.getStatus('user-1', 'job-x')).rejects.toMatchObject({
        status: 404,
        response: { code: 'VOICE_JOB_NOT_FOUND' },
      });
    });

    it('다른 사용자의 작업은 없는 것과 똑같이 404이다', async () => {
      queue.getJob.mockResolvedValue(jobIn('completed'));

      await expect(service.getStatus('user-2', 'job-1')).rejects.toMatchObject({
        status: 404,
        response: { code: 'VOICE_JOB_NOT_FOUND' },
      });
    });

    it.each(['waiting', 'delayed', 'prioritized', 'waiting-children'])(
      '%s는 QUEUED이다',
      async (state) => {
        queue.getJob.mockResolvedValue(jobIn(state));

        await expect(service.getStatus('user-1', 'job-1')).resolves.toEqual({
          jobId: 'job-1',
          status: 'QUEUED',
        });
      },
    );

    it('active는 PROCESSING이다', async () => {
      queue.getJob.mockResolvedValue(jobIn('active'));

      await expect(service.getStatus('user-1', 'job-1')).resolves.toEqual({
        jobId: 'job-1',
        status: 'PROCESSING',
      });
    });

    it('완료되어 성공 결과가 있으면 COMPLETED와 결과를 돌려준다', async () => {
      const result = { transcript: '강남에서 사당', briefingText: '안내' };
      queue.getJob.mockResolvedValue(
        jobIn('completed', { returnvalue: { ok: true, result } }),
      );

      await expect(service.getStatus('user-1', 'job-1')).resolves.toEqual({
        jobId: 'job-1',
        status: 'COMPLETED',
        result,
      });
    });

    it('완료되었지만 업무 오류 결과면 FAILED와 그 오류 코드를 돌려준다', async () => {
      const error = {
        code: 'HTTP_ERROR',
        message: "도착역 '없는역'을(를) 찾을 수 없습니다.",
        status: 404,
      };
      queue.getJob.mockResolvedValue(
        jobIn('completed', { returnvalue: { ok: false, error } }),
      );

      await expect(service.getStatus('user-1', 'job-1')).resolves.toEqual({
        jobId: 'job-1',
        status: 'FAILED',
        error,
      });
    });

    it('BullMQ가 실패로 표시한 작업은 FAILED VOICE_JOB_FAILED이다', async () => {
      queue.getJob.mockResolvedValue(jobIn('failed'));

      await expect(
        service.getStatus('user-1', 'job-1'),
      ).resolves.toMatchObject({
        status: 'FAILED',
        error: { code: 'VOICE_JOB_FAILED', status: 500 },
      });
    });

    it('결과 값이 없는 완료 작업도 FAILED로 안전하게 처리한다', async () => {
      queue.getJob.mockResolvedValue(jobIn('completed'));

      await expect(
        service.getStatus('user-1', 'job-1'),
      ).resolves.toMatchObject({
        status: 'FAILED',
        error: { code: 'VOICE_JOB_FAILED' },
      });
    });

    it('큐를 쓸 수 없으면 503이다', async () => {
      queue.getJob.mockRejectedValue(new Error('connection closed'));

      await expect(service.getStatus('user-1', 'job-1')).rejects.toMatchObject({
        errorCode: 'VOICE_QUEUE_UNAVAILABLE',
      });
    });
  });
});
