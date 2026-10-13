import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SttQueueClient } from './stt-queue.client';
import { ValkeyService } from './valkey.service';

const mockQueue = {
  add: jest.fn(),
  getJob: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
};
const mockEvents = {
  close: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
};
const queueCtor = jest.fn(() => mockQueue);

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((...args: unknown[]) => queueCtor(...(args as []))),
  QueueEvents: jest.fn().mockImplementation(() => mockEvents),
}));

describe('SttQueueClient', () => {
  let valkey: { options: object | null; createConnection: jest.Mock };

  const make = (env: Record<string, string> = {}) =>
    new SttQueueClient(
      valkey as unknown as ValkeyService,
      { get: (key: string) => env[key] } as unknown as ConfigService,
    );

  const jobReturning = (
    result: unknown,
    extra: Record<string, unknown> = {},
  ) => ({
    id: 'stt-1',
    waitUntilFinished: jest.fn().mockResolvedValue(result),
    isWaiting: jest.fn().mockResolvedValue(false),
    remove: jest.fn().mockResolvedValue(undefined),
    ...extra,
  });

  const expectUnavailable = (promise: Promise<unknown>) =>
    expect(promise).rejects.toMatchObject({
      errorCode: 'AI_SERVICE_UNAVAILABLE',
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    valkey = { options: { host: 'valkey', port: 6379 }, createConnection: jest.fn(() => ({})) };
    mockQueue.getJob.mockResolvedValue(undefined);
  });

  it('stt 작업을 AI 큐에 base64 오디오로 넣고 전사문을 돌려준다', async () => {
    const job = jobReturning({ transcript: ' 강남에서 사당까지 ', durationSec: 2.5 });
    mockQueue.add.mockResolvedValue(job);

    const result = await make().transcribe(Buffer.from('audio-bytes'));

    expect(result).toEqual({ transcript: '강남에서 사당까지', durationSec: 2.5 });
    expect(mockQueue.add).toHaveBeenCalledWith(
      'stt',
      { action: 'stt', audioBase64: Buffer.from('audio-bytes').toString('base64') },
      expect.objectContaining({ attempts: 1 }),
    );
  });

  it('끝난 작업은 짧게만 보관하도록 요청한다', async () => {
    mockQueue.add.mockResolvedValue(jobReturning({ transcript: '안내' }));

    await make().transcribe(Buffer.from('a'));

    const options = mockQueue.add.mock.calls[0][2];
    expect(options.removeOnComplete).toEqual({ age: 30, count: 50 });
    expect(options.removeOnFail).toEqual({ age: 60, count: 50 });
  });

  it('큐 이름은 VOICE_QUEUE_NAME으로 바꿀 수 있다', async () => {
    mockQueue.add.mockResolvedValue(jobReturning({ transcript: '안내' }));

    await make({ VOICE_QUEUE_NAME: 'custom-voice' }).transcribe(Buffer.from('a'));

    expect(queueCtor).toHaveBeenCalledWith('custom-voice', expect.anything());
  });

  it('기본 큐 이름은 AI 서비스와 같은 subway-voice이다', async () => {
    mockQueue.add.mockResolvedValue(jobReturning({ transcript: '안내' }));

    await make().transcribe(Buffer.from('a'));

    expect(queueCtor).toHaveBeenCalledWith('subway-voice', expect.anything());
  });

  it('제한 시간을 job.waitUntilFinished에 넘긴다', async () => {
    const job = jobReturning({ transcript: '안내' });
    mockQueue.add.mockResolvedValue(job);

    await make({ VOICE_STT_TIMEOUT_MS: '1234' }).transcribe(Buffer.from('a'));

    expect(job.waitUntilFinished).toHaveBeenCalledWith(mockEvents, 1234);
  });

  it('Valkey가 설정되지 않았으면 503이고 큐를 만들지 않는다', async () => {
    valkey.options = null;

    await expectUnavailable(make().transcribe(Buffer.from('a')));

    expect(queueCtor).not.toHaveBeenCalled();
  });

  it('AI 워커가 오류 결과를 주면 503이다', async () => {
    mockQueue.add.mockResolvedValue(
      jobReturning({ error: 'Missing audio_base64 in payload' }),
    );

    await expectUnavailable(make().transcribe(Buffer.from('a')));
  });

  it('전사문이 비어 있으면 AI 고장이 아니라 422 VOICE_NO_SPEECH이다', async () => {
    mockQueue.add.mockResolvedValue(jobReturning({ transcript: '   ' }));

    await expect(make().transcribe(Buffer.from('a'))).rejects.toMatchObject({
      errorCode: 'VOICE_NO_SPEECH',
      status: 422,
    });
  });

  it('전사문이 아예 빈 문자열이어도 VOICE_NO_SPEECH이다', async () => {
    mockQueue.add.mockResolvedValue(jobReturning({ transcript: '' }));

    await expect(make().transcribe(Buffer.from('a'))).rejects.toMatchObject({
      errorCode: 'VOICE_NO_SPEECH',
    });
  });

  it('결과 형식이 다르면 503이다', async () => {
    mockQueue.add.mockResolvedValue(jobReturning({ text: '안내' }));

    await expectUnavailable(make().transcribe(Buffer.from('a')));
  });

  it('AI 워커가 작업을 실패시키면 503이다', async () => {
    mockQueue.add.mockResolvedValue(
      jobReturning(null, {
        waitUntilFinished: jest.fn().mockRejectedValue(new Error('whisper crashed')),
      }),
    );

    await expectUnavailable(make().transcribe(Buffer.from('a')));
  });

  it('시간 안에 끝나지 않고 아직 대기 중이면 작업을 지워 오디오가 큐에 남지 않게 한다', async () => {
    const job = jobReturning(null, {
      waitUntilFinished: jest.fn().mockRejectedValue(new Error('timed out')),
    });
    const stored = {
      isWaiting: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    mockQueue.add.mockResolvedValue(job);
    mockQueue.getJob.mockResolvedValue(stored);

    await expectUnavailable(make().transcribe(Buffer.from('a')));

    expect(mockQueue.getJob).toHaveBeenCalledWith('stt-1');
    expect(stored.remove).toHaveBeenCalledTimes(1);
  });

  it('이미 처리 중인 작업은 지우지 않는다', async () => {
    mockQueue.add.mockResolvedValue(
      jobReturning(null, {
        waitUntilFinished: jest.fn().mockRejectedValue(new Error('timed out')),
      }),
    );
    const stored = {
      isWaiting: jest.fn().mockResolvedValue(false),
      remove: jest.fn(),
    };
    mockQueue.getJob.mockResolvedValue(stored);

    await expectUnavailable(make().transcribe(Buffer.from('a')));

    expect(stored.remove).not.toHaveBeenCalled();
  });

  it('큐에 넣는 것부터 실패하면 503이다', async () => {
    mockQueue.add.mockRejectedValue(new Error('ECONNREFUSED'));

    await expectUnavailable(make().transcribe(Buffer.from('a')));
  });

  it('큐와 이벤트 연결은 한 번만 만들어 재사용한다', async () => {
    mockQueue.add.mockResolvedValue(jobReturning({ transcript: '안내' }));
    const client = make();

    await client.transcribe(Buffer.from('a'));
    await client.transcribe(Buffer.from('b'));

    expect(queueCtor).toHaveBeenCalledTimes(1);
  });

  it('종료할 때 큐와 이벤트 연결을 닫는다', async () => {
    mockQueue.add.mockResolvedValue(jobReturning({ transcript: '안내' }));
    const client = make();
    await client.transcribe(Buffer.from('a'));

    await client.onModuleDestroy();

    expect(mockQueue.close).toHaveBeenCalled();
    expect(mockEvents.close).toHaveBeenCalled();
  });

  describe('완료 이벤트를 놓쳤을 때', () => {
    // 이벤트가 영영 오지 않는 작업. QueueEvents가 연결 직후의 이벤트를 놓친 상황을 흉내 낸다
    const jobWithoutEvent = () =>
      jobReturning(undefined, {
        waitUntilFinished: jest.fn(() => new Promise(() => undefined)),
      });
    const storedJob = (state: string, extra: Record<string, unknown> = {}) => ({
      getState: jest.fn().mockResolvedValue(state),
      ...extra,
    });

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('작업 상태가 completed이면 이벤트가 없어도 결과를 돌려준다', async () => {
      mockQueue.add.mockResolvedValue(jobWithoutEvent());
      mockQueue.getJob.mockResolvedValue(
        storedJob('completed', { returnvalue: { transcript: '강남에서 사당까지' } }),
      );

      const pending = make().transcribe(Buffer.from('a'));
      await jest.advanceTimersByTimeAsync(1000);

      await expect(pending).resolves.toEqual({
        transcript: '강남에서 사당까지',
        durationSec: undefined,
      });
      expect(mockQueue.getJob).toHaveBeenCalledWith('stt-1');
    });

    it('작업 상태가 failed이면 AI_SERVICE_UNAVAILABLE이다', async () => {
      mockQueue.add.mockResolvedValue(jobWithoutEvent());
      mockQueue.getJob.mockResolvedValue(
        storedJob('failed', { failedReason: 'worker crashed' }),
      );

      const pending = make().transcribe(Buffer.from('a'));
      const check = expectUnavailable(pending);
      await jest.advanceTimersByTimeAsync(1000);

      await check;
    });

    it('아직 처리 중이면 계속 확인하고 끝나면 결과를 돌려준다', async () => {
      mockQueue.add.mockResolvedValue(jobWithoutEvent());
      mockQueue.getJob
        .mockResolvedValueOnce(storedJob('active'))
        .mockRejectedValueOnce(new Error('valkey blip'))
        .mockResolvedValue(
          storedJob('completed', { returnvalue: { transcript: '안내' } }),
        );

      const pending = make().transcribe(Buffer.from('a'));
      await jest.advanceTimersByTimeAsync(3000);

      await expect(pending).resolves.toMatchObject({ transcript: '안내' });
      expect(mockQueue.getJob).toHaveBeenCalledTimes(3);
    });

    it('이벤트로 먼저 끝나면 상태를 확인하지 않는다', async () => {
      mockQueue.add.mockResolvedValue(jobReturning({ transcript: '안내' }));

      await make().transcribe(Buffer.from('a'));
      await jest.advanceTimersByTimeAsync(5000);

      expect(mockQueue.getJob).not.toHaveBeenCalled();
    });
  });
});
