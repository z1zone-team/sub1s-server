import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { ClerkAuthGuard } from '../src/infra/auth/clerk-auth.guard';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { DataUpdateBatchService } from '../src/infra/batch/data-update-batch.service';

describe('Full User Journey (Mobile App ↔ Backend E2E)', () => {
  let app: INestApplication;
  let batchService: DataUpdateBatchService;

  const mockUser = {
    id: '00000000-0000-0000-0000-000000000001',
    clerkId: 'user_journey_test_1',
    nickname: '통근러1호',
    profileImageUrl: 'https://example.com/profile.png',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockLogs: Array<{
    id: string;
    userId: string;
    originStationId: string;
    destStationId: string;
    totalDistanceKm: number;
    transferCount: number;
    earnedPoints: number;
    routeMode?: string | null;
    createdAt: Date;
    originStation: { stationName: string };
    destStation: { stationName: string };
  }> = [];

  const mockScores: Array<{
    userId: string;
    periodType: string;
    periodKey: string;
    totalPoints: number;
    totalDistanceKm: number;
    user: { nickname: string; profileImageUrl?: string };
  }> = [];

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
    user: {
      upsert: jest.fn().mockResolvedValue(mockUser),
      findUnique: jest.fn().mockResolvedValue(mockUser),
    },
    travelLog: {
      create: jest.fn().mockImplementation((args) => {
        const item = {
          id: `log-journey-${mockLogs.length + 1}`,
          ...args.data,
          createdAt: new Date(),
          originStation: { stationName: '강남' },
          destStation: { stationName: '역삼' },
        };
        mockLogs.push(item);
        return Promise.resolve(item);
      }),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(mockLogs)),
      count: jest.fn().mockImplementation(() => Promise.resolve(mockLogs.length)),
    },
    rankScore: {
      upsert: jest.fn().mockImplementation((args) => {
        const item = {
          userId: args.create.userId,
          periodType: args.create.periodType,
          periodKey: args.create.periodKey,
          totalPoints: args.create.totalPoints,
          totalDistanceKm: args.create.totalDistanceKm,
          user: { nickname: mockUser.nickname, profileImageUrl: mockUser.profileImageUrl },
        };
        mockScores.push(item);
        return Promise.resolve(item);
      }),
      findMany: jest.fn().mockImplementation((args) => {
        if (!args || !args.where) return Promise.resolve(mockScores);
        return Promise.resolve(
          mockScores.filter(
            (s) =>
              (!args.where.periodType || s.periodType === args.where.periodType) &&
              (!args.where.periodKey || s.periodKey === args.where.periodKey),
          ),
        );
      }),
      findUnique: jest.fn().mockImplementation(() =>
        Promise.resolve(
          mockScores.find((s) => s.userId === mockUser.id) ?? {
            userId: mockUser.id,
            totalPoints: 150,
            totalDistanceKm: 15.0,
            user: { nickname: mockUser.nickname },
          },
        ),
      ),
      count: jest.fn().mockResolvedValue(1),
    },
    $transaction: jest
      .fn()
      .mockImplementation((promises) => Promise.all(promises)),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = mockUser;
          return true;
        },
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

    batchService = app.get<DataUpdateBatchService>(DataUpdateBatchService);
  });

  afterAll(async () => {
    await app.close();
  });

  let trackingSessionId: string;
  let searchedRouteOption: any;

  it('Step 1: User Profile & Authentication Verification (GET /api/v1/auth/me)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(mockUser.id);
    expect(res.body.data.nickname).toBe(mockUser.nickname);
  });

  it('Step 2: Multi-Modal Route Search with Calibrated Transits & Stairs (POST /api/v1/routes/search)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routes/search')
      .send({
        originStationId: '02_222', // 강남
        destinationStationId: '01_133', // 서울역
        routeMode: 'OPTIMAL',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    const { options } = res.body.data;
    expect(Array.isArray(options)).toBe(true);
    expect(options.length).toBeGreaterThanOrEqual(1);

    const optimal = options.find((o: any) => o.mode === 'OPTIMAL');
    expect(optimal).toBeDefined();
    expect(optimal.totalDurationSec).toBeGreaterThan(0);
    expect(optimal.totalFare).toBeGreaterThan(0);
    expect(optimal.segments.length).toBeGreaterThan(0);

    // Save for subsequent tracking step
    searchedRouteOption = optimal;

    // Verify fast transfer doors (KRIC stairs integration)
    const leg1 = optimal.segments[0];
    expect(leg1.recommendedDoors).toBeDefined();
  });

  it('Step 3: Real-Time Train Congestion Inquiry (GET /api/v1/congestion/train)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/congestion/train')
      .query({
        lineId: '02',
        trainId: '2145',
        stationId: '02_222',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    const { trainId, cars } = res.body.data;
    expect(trainId).toBe('2145');
    expect(Array.isArray(cars)).toBe(true);
    expect(cars.length).toBe(10);
    expect(cars[0].carNo).toBe(1);
    expect(cars[0].rate).toBeGreaterThanOrEqual(0);
  });

  it('Step 4-A: Active Ride Navigation Start (POST /api/v1/routes/track/start)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routes/track/start')
      .send({
        routeOption: searchedRouteOption,
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.sessionId).toBeDefined();
    expect(res.body.data.currentStationId).toBe('02_222');
    expect(res.body.data.isOffRoute).toBe(false);
    trackingSessionId = res.body.data.sessionId;
  });

  it('Step 4-B: Periodic Location & Station Reporting (POST /api/v1/routes/track/location)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routes/track/location')
      .send({
        sessionId: trackingSessionId,
        currentStationId: '02_222',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.currentStationId).toBe('02_222');
  });

  it('Step 4-C: Off-Route Deviation Detection Check (POST /api/v1/routes/track/deviate)', async () => {
    // Normal on-route advance check (first leg transfer/destination station)
    const onRouteStation = searchedRouteOption.segments[0].toStationId;
    const onRouteRes = await request(app.getHttpServer())
      .post('/api/v1/routes/track/deviate')
      .send({
        sessionId: trackingSessionId,
        detectedStationId: onRouteStation,
      })
      .expect(201);

    expect(onRouteRes.body.success).toBe(true);
    expect(onRouteRes.body.data.isOffRoute).toBe(false);

    // Deviated station check (wrong direction/line)
    const deviateRes = await request(app.getHttpServer())
      .post('/api/v1/routes/track/deviate')
      .send({
        sessionId: trackingSessionId,
        detectedStationId: '07_730', // 강남구청 (wrong line)
      })
      .expect(201);

    expect(deviateRes.body.success).toBe(true);
    expect(deviateRes.body.data.isOffRoute).toBe(true);
    expect(deviateRes.body.data.rerouteOption).toBeDefined();
  });

  it('Step 5: Travel Completion & Travel Log Persistence (POST /api/v1/travel/log)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/travel/log')
      .send({
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: trackingSessionId,
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.earnedPoints).toBeGreaterThan(0);
    expect(res.body.data.totalDistanceKm).toBeGreaterThan(0);
    expect(mockLogs.length).toBeGreaterThan(0);
    // 안내 세션을 못 찾으면(TrackingModule이 저장소를 내보내지 않은 E-82) 경로 모드가 비고 OPTIMAL 재계산 값이 저장된다.
    // 세션이 연결되면 안내를 시작할 때 고른 경로 모드가 기록에 남는다.
    const saved = mockLogs[mockLogs.length - 1];
    expect(saved.routeMode).toBe(searchedRouteOption.mode);
  });

  it('Step 6-A: User Travel Timeline Inquiry (GET /api/v1/travel/timeline)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/travel/timeline')
      .query({ year: 2026, month: 10 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.logs)).toBe(true);
    expect(res.body.data.logs.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.logs[0].originStationName).toBe('강남');
  });

  it('Step 6-B: User Travel Statistics Inquiry (GET /api/v1/travel/stats)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/travel/stats')
      .query({ period: 'MONTH' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.period).toBe('MONTH');
    expect(res.body.data.totalDistanceKm).toBeGreaterThan(0);
    expect(res.body.data.totalTravelCount).toBeGreaterThanOrEqual(1);
  });

  it('Step 6-C: Subway Line Map Coverage Inquiry (GET /api/v1/line-map)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/line-map')
      .query({ period: 'MONTH' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.period).toBe('MONTH');
    expect(Array.isArray(res.body.data.lines)).toBe(true);
    expect(res.body.data.lines.length).toBeGreaterThan(0);
  });

  it('Step 7: Community Leaderboard & Ranking Inquiry (GET /api/v1/ranking)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ranking')
      .query({ periodType: 'MONTHLY', periodKey: '2026-10' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.periodType).toBe('MONTHLY');
    expect(Array.isArray(res.body.data.leaderboard)).toBe(true);
    expect(res.body.data.myRank).toBe(1);
  });

  it('Step 8: Public Data Pipeline Consistency & Snapshot Integrity Check', async () => {
    const diff = await batchService.checkAndUpdate({
      offlineOnly: true,
      dryRun: true,
    });

    expect(diff.hasChanges).toBe(false);
    expect(diff.summary.baselineStations).toBe(799);
    expect(diff.summary.baselineEdges).toBe(1576);
    expect(diff.summary.baselineTransfers).toBe(361);
  });
});
