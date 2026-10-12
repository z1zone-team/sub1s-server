import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';
import { ClerkAuthGuard } from '../src/infra/auth/clerk-auth.guard';

describe('Voice TTS stream (e2e)', () => {
  let app: INestApplication;
  let fakeAi: Server;
  let aiBehavior: 'ok' | 'error' | 'empty' | 'broken' = 'ok';
  const requestedTexts: string[] = [];
  const MP3_BYTES = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x10, 0x20]);
  const originalAiUrl = process.env.AI_SERVICE_URL;

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

  const stream = (text?: string) => {
    const req = request(app.getHttpServer()).get('/api/v1/voice/tts/stream');
    return text === undefined ? req : req.query({ text });
  };

  beforeAll(async () => {
    // AI 서비스를 흉내 내는 서버. 받은 문장을 기록하고 MP3 바이트를 스트리밍한다
    fakeAi = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/api/v1/ai/tts/stream') {
        res.statusCode = 404;
        res.end();
        return;
      }
      requestedTexts.push(url.searchParams.get('text') ?? '');
      if (aiBehavior === 'error') {
        res.statusCode = 500;
        res.end('boom');
        return;
      }
      if (aiBehavior === 'empty') {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.end();
        return;
      }
      if (aiBehavior === 'broken') {
        // 실제 AI 서비스처럼 200 헤더를 보낸 뒤 합성이 실패해 연결이 끊긴다
        res.setHeader('Content-Type', 'audio/mpeg');
        res.flushHeaders();
        setTimeout(() => res.destroy(), 20);
        return;
      }
      res.setHeader('Content-Type', 'audio/mpeg');
      res.write(MP3_BYTES.subarray(0, 3));
      setTimeout(() => res.end(MP3_BYTES.subarray(3)), 20);
    });
    await new Promise<void>((done) => fakeAi.listen(0, '127.0.0.1', done));
    process.env.AI_SERVICE_URL = `http://127.0.0.1:${(fakeAi.address() as AddressInfo).port}`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ClerkAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = {
            id: '00000000-0000-0000-0000-0000000000a1',
            clerkId: 'e2e_tts',
            nickname: 'tts',
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
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await new Promise((done) => fakeAi.close(done));
    if (originalAiUrl === undefined) delete process.env.AI_SERVICE_URL;
    else process.env.AI_SERVICE_URL = originalAiUrl;
  });

  beforeEach(() => {
    aiBehavior = 'ok';
    requestedTexts.length = 0;
  });

  it('AI 서비스의 MP3를 그대로 스트리밍한다', async () => {
    const res = await stream('강남역에서 을지로입구역까지 안내해 드릴게요.')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.headers['content-disposition']).toContain('inline');
    expect(Buffer.compare(res.body as Buffer, MP3_BYTES)).toBe(0);
    expect(requestedTexts).toEqual(['강남역에서 을지로입구역까지 안내해 드릴게요.']);
  });

  it('문장의 앞뒤 공백은 지우고 AI 서비스에 보낸다', async () => {
    await stream('  안내합니다  ')
      .buffer(true)
      .parse((response, callback) => {
        response.on('data', () => undefined);
        response.on('end', () => callback(null, Buffer.alloc(0)));
      })
      .expect(200);

    expect(requestedTexts).toEqual(['안내합니다']);
  });

  it('문장이 없으면 400이고 AI 서비스를 부르지 않는다', async () => {
    await stream().expect(400);
    await stream('   ').expect(400);

    expect(requestedTexts).toHaveLength(0);
  });

  it('문장이 500자를 넘으면 400이다', async () => {
    await stream('가'.repeat(501)).expect(400);

    expect(requestedTexts).toHaveLength(0);
  });

  it('500자까지는 받는다', async () => {
    await stream('가'.repeat(500))
      .buffer(true)
      .parse((response, callback) => {
        response.on('data', () => undefined);
        response.on('end', () => callback(null, Buffer.alloc(0)));
      })
      .expect(200);

    expect(requestedTexts[0]).toHaveLength(500);
  });

  it('AI 서비스가 200으로 빈 오디오를 주면 503이다', async () => {
    aiBehavior = 'empty';

    const res = await stream('안내합니다').expect(503);

    expect(res.body.error.code).toBe('AI_SERVICE_UNAVAILABLE');
  });

  it('AI 서비스가 200 뒤에 연결을 끊어도 503이다 (Edge-TTS 합성 실패와 같은 모양)', async () => {
    aiBehavior = 'broken';

    const res = await stream('안내합니다').expect(503);

    expect(res.body.error.code).toBe('AI_SERVICE_UNAVAILABLE');
  });

  it('AI 서비스가 오류를 내면 503 AI_SERVICE_UNAVAILABLE이다', async () => {
    aiBehavior = 'error';

    const res = await stream('안내합니다').expect(503);

    expect(res.body.error.code).toBe('AI_SERVICE_UNAVAILABLE');
  });
});
