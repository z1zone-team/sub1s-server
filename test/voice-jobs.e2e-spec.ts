import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { io, Socket } from 'socket.io-client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';
import { ClerkAuthGuard } from '../src/infra/auth/clerk-auth.guard';
import { MOCK_USER_ID } from '../src/infra/auth/mock-auth.guard';

// 실제 Valkey와 WebSocket을 쓰는 통합 테스트라 느린 CI 머신에서는 첫 요청(큐와 이벤트 연결 초기화, 경로 탐색 첫 호출)이 Jest 기본 5초를 넘긴 적이 있다
jest.setTimeout(30000);

/**
 * 음성 경로 추천 큐 e2e. 실제 Valkey(VALKEY_HOST, 기본 127.0.0.1:6379)와 실제 WebSocket을 쓰고,
 * AI 서비스의 STT 워커만 같은 큐를 소비하는 가짜 BullMQ 워커로 대신한다.
 */
describe('Voice jobs (e2e)', () => {
  // 실제 Valkey, BullMQ, WebSocket을 쓰고 CI에서는 jest 워커가 병렬로 돌아 5초 기본값으로는 모자란다
  jest.setTimeout(30000);

  const VALKEY_HOST = process.env.VALKEY_HOST ?? '127.0.0.1';
  const VALKEY_PORT = process.env.VALKEY_PORT ?? '6379';
  const suffix = randomUUID().slice(0, 8);
  const AI_QUEUE = `e2e-subway-voice-${suffix}`;
  const PIPELINE_QUEUE = `e2e-voice-route-${suffix}`;
  const saved: Record<string, string | undefined> = {};

  let app: INestApplication;
  let port: number;
  let fakeAi: Worker;
  let socket: Socket;
  let redis: Redis;

  type AiBehavior = 'ok' | 'slow' | 'error' | 'empty';
  let aiBehavior: AiBehavior = 'ok';
  let aiTranscript = '강남에서 사당까지 가장 빠르게';
  const aiJobs: unknown[] = [];

  const mockGraphRepository: ISubwayGraphRepository = {
    loadGraphData: async () => {
      const dataDir = resolve(__dirname, '../src/data/subway');
      const read = (name: string) =>
        JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8'));
      return {
        stations: read('stations.json'),
        edges: read('edges.json'),
        transfers: read('transfers.json'),
      };
    },
  };

  const audio = (bytes = 2000) => Buffer.alloc(bytes, 9);
  const submit = (userId = MOCK_USER_ID, bytes = 2000) =>
    request(app.getHttpServer())
      .post('/api/v1/voice/jobs')
      .set('x-test-user', userId)
      .attach('file', audio(bytes), {
        filename: 'query.m4a',
        contentType: 'audio/m4a',
      });
  const status = (jobId: string, userId = MOCK_USER_ID) =>
    request(app.getHttpServer())
      .get(`/api/v1/voice/jobs/${jobId}`)
      .set('x-test-user', userId);

  // 소켓 이벤트는 도착하는 대로 모아 둔다. 202 응답을 처리하는 동안 작업이 끝나 이벤트가 먼저 와도
  // 놓치지 않게 하기 위해서다(앱도 요청 전에 채널을 열어 같은 방식으로 받는다)
  const received = new Map<string, unknown>();
  const VOICE_EVENTS = ['voice_result', 'voice_failed'];

  const waitFor = <T>(event: string, jobId: string): Promise<T> =>
    new Promise<T>((resolvePromise, reject) => {
      const early = received.get(`${event}:${jobId}`);
      if (early) {
        resolvePromise(early as T);
        return;
      }
      const timer = setTimeout(
        () => reject(new Error(`${event} for ${jobId} not received`)),
        15000,
      );
      const handler = (payload: { jobId: string }) => {
        if (payload.jobId !== jobId) return;
        clearTimeout(timer);
        socket.off(event, handler);
        resolvePromise(payload as unknown as T);
      };
      socket.on(event, handler);
    });

  const untilFinished = async (jobId: string) => {
    for (let i = 0; i < 100; i++) {
      const res = await status(jobId);
      if (['COMPLETED', 'FAILED'].includes(res.body.data.status)) return res;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('job did not finish');
  };

  beforeAll(async () => {
    for (const key of [
      'VALKEY_HOST',
      'VALKEY_PORT',
      'VOICE_QUEUE_NAME',
      'VOICE_PIPELINE_QUEUE_NAME',
    ]) {
      saved[key] = process.env[key];
    }
    process.env.VALKEY_HOST = VALKEY_HOST;
    process.env.VALKEY_PORT = VALKEY_PORT;
    process.env.VOICE_QUEUE_NAME = AI_QUEUE;
    process.env.VOICE_PIPELINE_QUEUE_NAME = PIPELINE_QUEUE;

    const connection = {
      host: VALKEY_HOST,
      port: Number(VALKEY_PORT),
      maxRetriesPerRequest: null,
    };
    fakeAi = new Worker(
      AI_QUEUE,
      async (job) => {
        aiJobs.push(job.data);
        if (aiBehavior === 'error') throw new Error('whisper crashed');
        if (aiBehavior === 'empty') return { transcript: '   ', durationSec: 0 };
        if (aiBehavior === 'slow') await new Promise((r) => setTimeout(r, 400));
        return { transcript: aiTranscript, durationSec: 2.5 };
      },
      { connection },
    );
    redis = new Redis({ host: VALKEY_HOST, port: Number(VALKEY_PORT) });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ClerkAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = {
            id: req.headers['x-test-user'] ?? MOCK_USER_ID,
            clerkId: 'e2e_voice',
            nickname: 'voice',
          };
          return true;
        },
      })
      .overrideProvider(SUBWAY_GRAPH_REPOSITORY)
      .useValue(mockGraphRepository)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0);
    const address = app.getHttpServer().address();
    port = typeof address === 'string' ? Number(address) : address.port;

    socket = io(`http://127.0.0.1:${port}/ws/subway`, {
      transports: ['websocket'],
      auth: { token: 'mock_e2e_voice' },
    });
    await new Promise<void>((done, reject) => {
      socket.on('connect', () => done());
      socket.on('connect_error', reject);
    });
    for (const event of VOICE_EVENTS) {
      socket.on(event, (payload: { jobId: string }) => {
        received.set(`${event}:${payload.jobId}`, payload);
      });
    }
  }, 30000);

  afterAll(async () => {
    socket?.close();
    await app?.close();
    await fakeAi?.close();
    // 이 실행이 만든 키만 지운다
    for (const name of [AI_QUEUE, PIPELINE_QUEUE]) {
      const keys = await redis.keys(`bull:${name}:*`);
      if (keys.length) await redis.del(...keys);
    }
    await redis.del(`voice:active:${MOCK_USER_ID}`, `lock:voice:${MOCK_USER_ID}`);
    await redis.quit();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 30000);

  beforeEach(async () => {
    aiBehavior = 'ok';
    aiTranscript = '강남에서 사당까지 가장 빠르게';
    aiJobs.length = 0;
    await redis.del(`voice:active:${MOCK_USER_ID}`, `lock:voice:${MOCK_USER_ID}`);
  });

  it('요청을 큐에 넣고 202로 응답한 뒤 WebSocket으로 결과를 받는다', async () => {
    const res = await submit().expect(202);

    expect(res.body.data.status).toBe('QUEUED');
    const jobId: string = res.body.data.jobId;
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

    const event = await waitFor<{ jobId: string; result: any }>(
      'voice_result',
      jobId,
    );
    expect(event.result.transcript).toBe('강남에서 사당까지 가장 빠르게');
    expect(event.result.interpretedIntent).toMatchObject({
      originStationName: '강남',
      destStationName: '사당',
    });
    expect(event.result.recommendedRoute.segments.length).toBeGreaterThan(0);
    expect(event.result.briefingText).toContain('강남');
  });

  it('AI 큐에는 오디오가 base64로 담긴 stt 작업이 간다', async () => {
    const res = await submit().expect(202);
    await waitFor('voice_result', res.body.data.jobId);

    expect(aiJobs).toHaveLength(1);
    const data = aiJobs[0] as { action: string; audioBase64: string };
    expect(data.action).toBe('stt');
    expect(Buffer.from(data.audioBase64, 'base64')).toEqual(audio());
  });

  it('WebSocket 이벤트를 놓쳐도 GET으로 같은 결과를 조회한다', async () => {
    const res = await submit().expect(202);
    const jobId: string = res.body.data.jobId;
    const event = await waitFor<{ result: any }>('voice_result', jobId);

    const polled = await status(jobId).expect(200);

    expect(polled.body.data).toMatchObject({ status: 'COMPLETED', result: event.result });
    expect(polled.body.data.result).toEqual(event.result);
  });

  it('처리 중에 조회하면 QUEUED나 PROCESSING이고 끝나면 COMPLETED이다', async () => {
    aiBehavior = 'slow';
    const res = await submit().expect(202);
    const jobId: string = res.body.data.jobId;

    const early = await status(jobId).expect(200);
    expect(['QUEUED', 'PROCESSING']).toContain(early.body.data.status);
    expect(early.body.data.result).toBeUndefined();

    const done = await untilFinished(jobId);
    // 실패하면 오류 코드와 메시지가 함께 보이도록 객체째로 비교한다 (CI에서 원인을 바로 알 수 있게)
    expect(done.body.data).toMatchObject({ status: 'COMPLETED' });
  });

  it('역을 찾지 못하면 voice_failed로 같은 오류 코드와 메시지를 보낸다', async () => {
    aiTranscript = '강남에서 없는역까지';
    const res = await submit().expect(202);
    const jobId: string = res.body.data.jobId;

    const event = await waitFor<{ error: any }>('voice_failed', jobId);

    expect(event.error.status).toBe(404);
    expect(event.error.message).toContain('없는');
    const polled = await status(jobId).expect(200);
    expect(polled.body.data.status).toBe('FAILED');
    expect(polled.body.data.error).toEqual(event.error);
  });

  it('AI 음성 인식이 실패하면 503 AI_SERVICE_UNAVAILABLE을 알린다', async () => {
    aiBehavior = 'error';
    const res = await submit().expect(202);

    const event = await waitFor<{ error: any }>(
      'voice_failed',
      res.body.data.jobId,
    );

    expect(event.error).toMatchObject({
      code: 'AI_SERVICE_UNAVAILABLE',
      status: 503,
    });
  });

  it('AI 음성 인식이 빈 전사를 주면 503으로 알린다', async () => {
    aiBehavior = 'empty';
    const res = await submit().expect(202);

    const event = await waitFor<{ error: any }>(
      'voice_failed',
      res.body.data.jobId,
    );

    expect(event.error.code).toBe('AI_SERVICE_UNAVAILABLE');
  });

  it('텍스트 힌트가 있으면 AI 큐를 거치지 않는다', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/voice/jobs')
      .set('x-test-user', MOCK_USER_ID)
      .field('transcriptHint', '홍대입구에서 신촌까지')
      .attach('file', audio(), { filename: 'q.m4a', contentType: 'audio/m4a' })
      .expect(202);

    const event = await waitFor<{ result: any }>(
      'voice_result',
      res.body.data.jobId,
    );

    expect(event.result.transcript).toBe('홍대입구에서 신촌까지');
    expect(aiJobs).toHaveLength(0);
  });

  it('진행 중인 작업이 있으면 같은 사용자의 새 요청은 429이고 끝나면 다시 받는다', async () => {
    aiBehavior = 'slow';
    const first = await submit().expect(202);

    const second = await submit().expect(429);
    expect(second.body.error.code).toBe('VOICE_JOB_IN_PROGRESS');

    await waitFor('voice_result', first.body.data.jobId);
    // 진행 중 표시는 작업이 끝날 때 지워진다
    await submit().expect(202);
  });

  it('다른 사용자의 작업 조회는 없는 작업과 똑같이 404이다', async () => {
    const res = await submit().expect(202);
    const jobId: string = res.body.data.jobId;
    await waitFor('voice_result', jobId);

    const other = await status(jobId, randomUUID()).expect(404);

    expect(other.body.error.code).toBe('VOICE_JOB_NOT_FOUND');
    await status(randomUUID()).expect(404);
  });

  it('작업 ID가 UUID가 아니면 400이다', async () => {
    await status('not-a-uuid').expect(400);
  });

  it('오디오가 2MB를 넘으면 413이고 큐에 넣지 않는다', async () => {
    const res = await submit(MOCK_USER_ID, 2 * 1024 * 1024 + 1).expect(413);

    expect(res.body.error.code).toBe('VOICE_AUDIO_TOO_LARGE');
    expect(aiJobs).toHaveLength(0);
    // 거절된 요청은 진행 중 표시를 남기지 않는다
    await submit().expect(202);
  });

  it('오디오가 없으면 400이다', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/voice/jobs')
      .set('x-test-user', MOCK_USER_ID)
      .expect(400);
  });

  it('끝난 작업의 오디오는 큐에서 비운다', async () => {
    const res = await submit().expect(202);
    const jobId: string = res.body.data.jobId;
    await waitFor('voice_result', jobId);

    const stored = await redis.hget(
      `bull:${PIPELINE_QUEUE}:${jobId}`,
      'data',
    );

    expect(JSON.parse(stored as string).audioBase64).toBe('');
  });

  it('기존 동기 엔드포인트는 그대로 동작하고 5초 락은 Valkey를 쓴다', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/voice/route-recommend')
      .set('x-test-user', MOCK_USER_ID)
      .field('transcriptHint', '강남에서 사당까지')
      .attach('file', audio(), { filename: 'q.m4a', contentType: 'audio/m4a' })
      .expect(201);
    expect(first.body.data.interpretedIntent.destStationName).toBe('사당');

    expect(await redis.exists(`lock:voice:${MOCK_USER_ID}`)).toBe(1);
    await request(app.getHttpServer())
      .post('/api/v1/voice/route-recommend')
      .set('x-test-user', MOCK_USER_ID)
      .field('transcriptHint', '강남에서 사당까지')
      .attach('file', audio(), { filename: 'q.m4a', contentType: 'audio/m4a' })
      .expect(429);
  });
});
