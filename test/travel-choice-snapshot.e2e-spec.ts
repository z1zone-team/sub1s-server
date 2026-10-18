import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';
import { PrismaService } from '../src/infra/prisma/prisma.service';

const AUTH = { Authorization: 'Bearer mock_jwt_token' };

// 경로 검색 -> 추적 시작 -> 이동 완료까지 거쳐 선택 스냅샷이 travel_logs에 저장되는지 본다 (E-82)
describe('Travel log choice snapshot (e2e)', () => {
  let app: INestApplication;

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

  const created: Array<{ data: Record<string, unknown> }> = [];

  const mockPrisma = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
    user: { upsert: jest.fn().mockResolvedValue({ id: 'u' }) },
    travelLog: {
      create: jest.fn().mockImplementation((args) => {
        created.push(args);
        return Promise.resolve({ id: 'log-snapshot-1', ...args.data });
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    rankScore: {
      upsert: jest.fn().mockImplementation((args) =>
        Promise.resolve({
          userId: args.create.userId,
          totalPoints: args.create.totalPoints,
          totalDistanceKm: args.create.totalDistanceKm,
        }),
      ),
    },
    $transaction: jest
      .fn()
      .mockImplementation((promises) => Promise.all(promises)),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SUBWAY_GRAPH_REPOSITORY)
      .useValue(mockGraphRepository)
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
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
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('saves the snapshot and mode of the route the user chose', async () => {
    const server = app.getHttpServer();

    const search = await request(server)
      .post('/api/v1/routes/search')
      .set(AUTH)
      .send({
        originStationId: '02_222',
        destinationStationId: '02_221',
        routeMode: 'OPTIMAL',
      })
      .expect(200);
    const chosen = search.body.data.options[0];
    expect(chosen.routeId).toBeDefined();

    const start = await request(server)
      .post('/api/v1/routes/track/start')
      .set(AUTH)
      .send({ routeOption: chosen })
      .expect(201);

    await request(server)
      .post('/api/v1/travel/log')
      .set(AUTH)
      .send({
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: start.body.data.sessionId,
      })
      .expect(201);

    expect(created).toHaveLength(1);
    const data = created[0].data as {
      routeMode: string | null;
      choiceSnapshot?: { selected: Record<string, number>; alternatives: unknown[] };
    };
    expect(data.routeMode).toBe(chosen.mode);
    expect(data.choiceSnapshot).toBeDefined();
    expect(Object.keys(data.choiceSnapshot!.selected).length).toBeGreaterThan(0);
    expect(data.choiceSnapshot!.alternatives.length).toBeGreaterThan(0);
  });

  it('saves no snapshot when the log has no session', async () => {
    created.length = 0;

    await request(app.getHttpServer())
      .post('/api/v1/travel/log')
      .set(AUTH)
      .send({ originStationId: '02_222', destStationId: '02_221' })
      .expect(201);

    expect(created).toHaveLength(1);
    expect(created[0].data.choiceSnapshot).toBeUndefined();
    expect(created[0].data.routeMode).toBeNull();
  });
});
