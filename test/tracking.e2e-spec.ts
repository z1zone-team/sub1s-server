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

describe('Tracking (e2e)', () => {
  let app: INestApplication;

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
    $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
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

  it('runs complete lifecycle: starts tracking, advances on route, and detects deviation with emergency reroute', async () => {
    // 1. Search a route first (강남 02_222 -> 역삼 02_221)
    const routeRes = await request(app.getHttpServer())
      .post('/api/v1/routes/search')
      .send({
        originStationId: '02_222',
        destinationStationId: '02_221',
        routeMode: 'OPTIMAL',
      })
      .expect(200);

    const optimalRoute = routeRes.body.data.options[0];
    expect(optimalRoute).toBeDefined();

    // 2. Start tracking session
    const startRes = await request(app.getHttpServer())
      .post('/api/v1/routes/track/start')
      .send({
        routeOption: optimalRoute,
      })
      .expect(201);

    expect(startRes.body.success).toBe(true);
    const session = startRes.body.data;
    expect(session.sessionId).toBeDefined();
    expect(session.currentStationId).toBe('02_222');
    expect(session.isOffRoute).toBe(false);

    // 3. Report on-route station (역삼 02_221)
    const onRouteRes = await request(app.getHttpServer())
      .post('/api/v1/routes/track/deviate')
      .send({
        sessionId: session.sessionId,
        detectedStationId: '02_221',
      })
      .expect(201);

    expect(onRouteRes.body.success).toBe(true);
    expect(onRouteRes.body.data.isOffRoute).toBe(false);

    // 4. Report opposite/deviated station (교대 02_223) -> trigger emergency reroute
    const startTime = Date.now();
    const deviateRes = await request(app.getHttpServer())
      .post('/api/v1/routes/track/deviate')
      .send({
        sessionId: session.sessionId,
        detectedStationId: '02_223',
      })
      .expect(201);

    const elapsedMs = Date.now() - startTime;
    expect(elapsedMs).toBeLessThan(3000); // Must be within 3 seconds SLA!

    expect(deviateRes.body.success).toBe(true);
    const alert = deviateRes.body.data;
    expect(alert.isOffRoute).toBe(true);
    expect(alert.detectedStationId).toBe('02_223');
    expect(alert.reason).toBeDefined();
    expect(alert.rerouteOption).toBeDefined();
    expect(alert.rerouteOption.segments.length).toBeGreaterThan(0);
  });

  it('rejects deviate request for non-existent session with 404', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routes/track/deviate')
      .send({
        sessionId: '00000000-0000-0000-0000-000000000000',
        detectedStationId: '02_222',
      })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SESSION_NOT_FOUND');
  });
});
