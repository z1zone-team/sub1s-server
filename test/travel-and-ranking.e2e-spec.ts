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

describe('Travel and Ranking (e2e)', () => {
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

  const mockLogs: Array<{
    id: string;
    userId: string;
    originStationId: string;
    destStationId: string;
    totalDistanceKm: number;
    transferCount: number;
    earnedPoints: number;
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

  const mockPrisma = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    user: {
      upsert: jest
        .fn()
        .mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' }),
    },
    travelLog: {
      create: jest.fn().mockImplementation((args) => {
        const item = {
          id: 'log-e2e-1',
          ...args.data,
          createdAt: new Date(),
          originStation: { stationName: '강남' },
          destStation: { stationName: '역삼' },
        };
        mockLogs.push(item);
        return Promise.resolve(item);
      }),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(mockLogs)),
    },
    rankScore: {
      upsert: jest.fn().mockImplementation((args) => {
        const item = {
          userId: args.create.userId,
          periodType: args.create.periodType,
          periodKey: args.create.periodKey,
          totalPoints: args.create.totalPoints,
          totalDistanceKm: args.create.totalDistanceKm,
          user: { nickname: '테스트유저' },
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
          context.switchToHttp().getRequest().user = {
            id: '00000000-0000-0000-0000-000000000001',
            clerkId: 'user_mock_test_1',
            nickname: '테스트유저',
          };
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/v1/travel/log creates log with official distance and points', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/travel/log')
      .send({
        originStationId: '02_222',
        destStationId: '02_221',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.logId).toBe('log-e2e-1');
    expect(res.body.data.totalDistanceKm).toBeGreaterThan(0);
    expect(res.body.data.earnedPoints).toBeGreaterThan(0);
    expect(res.body.data.distancePoints + res.body.data.onTimeBonus).toBe(
      res.body.data.earnedPoints,
    );
    expect(typeof res.body.data.monthlyTotalPoints).toBe('number');
  });

  it('GET /api/v1/travel/timeline returns timeline logs', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/travel/timeline?year=2026&month=10')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.totalLogsCount).toBeGreaterThanOrEqual(1);
    expect(res.body.data.logs).toHaveLength(1);
    expect(res.body.data.logs[0].originStationName).toBe('강남');
  });

  it('GET /api/v1/ranking returns leaderboard and user rank', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ranking?periodType=MONTHLY&periodKey=2026-10')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.periodType).toBe('MONTHLY');
    expect(res.body.data.leaderboard).toBeDefined();
    expect(res.body.data.myRank).toBe(1);
  });

  it('GET /api/v1/travel/stats returns travel statistics for given period', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/travel/stats?period=MONTH')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.period).toBe('MONTH');
    expect(res.body.data.totalDistanceKm).toBeGreaterThan(0);
    expect(res.body.data.totalTravelCount).toBeGreaterThanOrEqual(1);
    expect(res.body.data.mostVisitedStations.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/line-map returns subway lines with station visited status', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/line-map?period=MONTH')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.period).toBe('MONTH');
    expect(res.body.data.lines).toBeInstanceOf(Array);
    expect(res.body.data.lines.length).toBeGreaterThan(0);

    const line02 = res.body.data.lines.find((l: any) => l.lineId === '02');
    expect(line02).toBeDefined();
    expect(line02.stations.length).toBeGreaterThan(0);
    expect(line02.colorHex).toBe('#00A84D');
  });

  it('GET /api/v1/line-map names and colors every line, with no gray fallback', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/line-map?period=ALL')
      .expect(200);

    const lines = res.body.data.lines as { lineId: string; lineName: string; colorHex: string }[];
    const byId = new Map(lines.map((l) => [l.lineId, l]));

    expect(lines.length).toBe(24);
    expect(lines.filter((l) => l.colorHex === '#888888')).toEqual([]);
    expect(byId.get('SD')).toMatchObject({ lineName: '수인분당선', colorHex: '#FABE00' });
    expect(byId.get('GG')).toMatchObject({ lineName: '경강선' });
    expect(byId.get('EV')).toMatchObject({ lineName: '에버라인' });
    expect(byId.get('I1')).toMatchObject({ lineName: '인천1호선' });
    expect(lines.every((l) => !l.lineName.endsWith('호선') || /^\d호선$|^인천\d호선$/.test(l.lineName))).toBe(true);
  });

  it('GET /api/v1/travel/line-map also works via travel route prefix', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/travel/line-map?period=ALL')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.period).toBe('ALL');
    expect(res.body.data.lines).toBeInstanceOf(Array);
  });
});
