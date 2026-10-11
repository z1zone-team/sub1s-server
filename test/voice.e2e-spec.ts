import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { AiServiceAdapter } from '../src/application/voice/services/ai-service.adapter';
import { VoiceLockService } from '../src/application/voice/services/voice-lock.service';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';
import { ClerkAuthGuard } from '../src/infra/auth/clerk-auth.guard';
import { PrismaService } from '../src/infra/prisma/prisma.service';

describe('Voice Route Recommend (e2e)', () => {
  let app: INestApplication;
  let voiceLockService: VoiceLockService;

  const mockGraphRepository: ISubwayGraphRepository = {
    loadGraphData: async () => {
      const dataDir = resolve(__dirname, '../src/data/subway');
      const stations = JSON.parse(
        readFileSync(resolve(dataDir, 'stations.json'), 'utf-8'),
      );
      const edges = JSON.parse(
        readFileSync(resolve(dataDir, 'edges.json'), 'utf-8'),
      );
      const transfers = JSON.parse(
        readFileSync(resolve(dataDir, 'transfers.json'), 'utf-8'),
      );
      return { stations, edges, transfers };
    },
  };

  const mockPrisma = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = {
            id: '00000000-0000-0000-0000-000000000001',
            clerkId: 'user_mock_test_1',
            nickname: '테스트유저',
          };
          return true;
        },
      })
      .overrideProvider(AiServiceAdapter)
      .useValue({
        transcribeAudio: jest.fn().mockResolvedValue({
          transcript: '강남역에서 을지로입구역까지 최적 경로로 안내해줘',
        }),
        generateBriefing: jest.fn().mockResolvedValue({
          briefingText: '강남역에서 을지로입구역까지 안내해 드릴게요.',
          audioTtsUrl: '/api/v1/voice/tts/stream?text=test',
        }),
      })
      .overrideProvider(SUBWAY_GRAPH_REPOSITORY)
      .useValue(mockGraphRepository)
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    voiceLockService = moduleRef.get<VoiceLockService>(VoiceLockService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    voiceLockService.clear();
  });

  it('POST /api/v1/voice/route-recommend - should return route recommendation from audio file', async () => {
    const fakeAudioBuffer = Buffer.from('RIFF....WAVEfmt ....data....');

    const res = await request(app.getHttpServer())
      .post('/api/v1/voice/route-recommend')
      .attach('file', fakeAudioBuffer, {
        filename: 'gangnam_to_euljiro.wav',
        contentType: 'audio/wav',
      })
      .field('preferredMode', 'OPTIMAL');

    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('transcript');
    expect(res.body.data).toHaveProperty('interpretedIntent');
    expect(res.body.data.interpretedIntent).toMatchObject({
      originStationName: expect.any(String),
      destStationName: expect.any(String),
      preferredMode: 'OPTIMAL',
      reason: expect.any(String),
    });
    expect(res.body.data).toHaveProperty('recommendedRoute');
    expect(res.body.data.recommendedRoute).toMatchObject({
      mode: 'OPTIMAL',
      totalDurationSec: expect.any(Number),
      totalDistanceKm: expect.any(Number),
      totalFare: expect.any(Number),
      transferCount: expect.any(Number),
    });
    expect(res.body.data).toHaveProperty('briefingText');
    expect(typeof res.body.data.briefingText).toBe('string');
    expect(res.body.data.briefingText.length).toBeGreaterThan(0);
    expect(res.body.data).toHaveProperty('audioTtsUrl');
  });

  it('POST /api/v1/voice/route-recommend - should reject consecutive duplicate requests with 429 (Idempotency Lock)', async () => {
    const fakeAudioBuffer = Buffer.from('sample-audio-bytes');

    // 1st request: Success
    const firstRes = await request(app.getHttpServer())
      .post('/api/v1/voice/route-recommend')
      .attach('file', fakeAudioBuffer, {
        filename: 'voice_query.mp3',
        contentType: 'audio/mpeg',
      });
    expect(firstRes.status).toBe(HttpStatus.CREATED);

    // 2nd request (immediately within 5 seconds): 429 Too Many Requests
    const secondRes = await request(app.getHttpServer())
      .post('/api/v1/voice/route-recommend')
      .attach('file', fakeAudioBuffer, {
        filename: 'voice_query.mp3',
        contentType: 'audio/mpeg',
      });

    expect(secondRes.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(secondRes.body.error.message).toContain(
      '이전 음성 요청을 처리 중입니다',
    );
  });

  it('POST /api/v1/voice/route-recommend - should return 400 when file is missing', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/voice/route-recommend')
      .field('preferredMode', 'OPTIMAL');

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('POST /api/v1/voice/route-recommend - should return 400 when file format is unsupported', async () => {
    const textBuffer = Buffer.from('not an audio file');

    const res = await request(app.getHttpServer())
      .post('/api/v1/voice/route-recommend')
      .attach('file', textBuffer, {
        filename: 'script.exe',
        contentType: 'application/x-msdownload',
      });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(res.body.error.message).toContain(
      '지원하지 않는 오디오 파일 형식입니다',
    );
  });
});
