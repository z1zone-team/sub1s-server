import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { SUBWAY_GRAPH_REPOSITORY } from '../src/domain/subway/ports/ISubwayGraphRepository';
import { ClerkAuthGuard } from '../src/infra/auth/clerk-auth.guard';
import { PrismaService } from '../src/infra/prisma/prisma.service';

describe('Settlement month queries (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const lineId = `m${tag}`;
  const user = {
    id: randomUUID(),
    clerkId: `e2e_month_${tag}`,
    nickname: `month_${tag}`,
  };
  const stations = [0, 1, 2].map((index) => ({
    id: `${lineId}_${index}`,
    lineId,
    stationCode: String(index),
    lineSeq: index + 1,
    stationName: `station-${index}`,
    lat: 37.5,
    lng: 127 + index / 100,
  }));
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ClerkAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = user;
          return true;
        },
      })
      .overrideProvider(SUBWAY_GRAPH_REPOSITORY)
      .useValue({
        loadGraphData: async () => ({ stations, edges: [], transfers: [] }),
      })
      .compile();
    app = module.createNestApplication();
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
    prisma = app.get(PrismaService);
    await prisma.user.create({ data: user });
    await prisma.subwayLine.create({
      data: { id: lineId, lineName: 'month-fixture', colorHex: '#000000' },
    });
    await prisma.station.createMany({ data: stations });
    await prisma.travelLog.createMany({
      data: [
        // KST 2월 시작 직전, 시작, 윤년 마지막 날 끝, 3월 시작.
        ['2024-01-31T14:59:59.999Z', 50, 2],
        ['2024-01-31T15:00:00.000Z', 3, 1],
        ['2024-02-29T14:59:59.999Z', 4, 1],
        ['2024-02-29T15:00:00.000Z', 60, 2],
        ['2025-11-30T15:00:00.000Z', 5, 1],
        ['2025-12-31T15:00:00.000Z', 80, 2],
      ].map(([at, km, destination]) => ({
        userId: user.id,
        originStationId: stations[0].id,
        destStationId: stations[Number(destination)].id,
        totalDistanceKm: Number(km),
        transferCount: 0,
        earnedPoints: 0,
        createdAt: new Date(String(at)),
      })),
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.travelLog.deleteMany({ where: { userId: user.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
      await prisma.station.deleteMany({ where: { lineId } });
      await prisma.subwayLine.deleteMany({ where: { id: lineId } });
    }
    await app?.close();
  });

  it('uses the same bounded KST leap month for stats, timeline and visited stations', async () => {
    const stats = (
      await http()
        .get('/api/v1/travel/stats')
        .query({ period: 'MONTH', periodKey: '2024-02' })
        .expect(200)
    ).body.data;
    expect(stats.totalDistanceKm).toBe(7);
    expect(stats.totalTravelCount).toBe(2);
    expect(stats.buckets).toHaveLength(29);
    expect(stats.buckets[0]).toEqual({
      key: '2024-02-01',
      distanceKm: 3,
      rideCount: 1,
    });
    expect(stats.buckets[28]).toEqual({
      key: '2024-02-29',
      distanceKm: 4,
      rideCount: 1,
    });
    const timeline = (
      await http()
        .get('/api/v1/travel/timeline')
        .query({ year: 2024, month: 2 })
        .expect(200)
    ).body.data;
    expect(timeline.totalDistanceKm).toBe(7);
    expect(timeline.totalLogsCount).toBe(2);
    const map = (
      await http()
        .get('/api/v1/line-map')
        .query({ period: 'MONTH', periodKey: '2024-02' })
        .expect(200)
    ).body.data;
    expect(
      map.lines[0].stations.map((s: { visited: boolean }) => s.visited),
    ).toEqual([true, true, false]);
  });

  it('excludes the following year from December and keeps all 31 buckets', async () => {
    const stats = (
      await http()
        .get('/api/v1/travel/stats')
        .query({ period: 'MONTH', periodKey: '2025-12' })
        .expect(200)
    ).body.data;
    expect(stats.totalDistanceKm).toBe(5);
    expect(stats.totalTravelCount).toBe(1);
    expect(stats.buckets).toHaveLength(31);
    expect(stats.buckets.at(-1).key).toBe('2025-12-31');
    const map = (
      await http()
        .get('/api/v1/line-map')
        .query({ period: 'MONTH', periodKey: '2025-12' })
        .expect(200)
    ).body.data;
    expect(map.lines[0].stations[2].visited).toBe(false);
  });

  it.each(['/api/v1/travel/stats', '/api/v1/line-map'])(
    'validates month keys and accepts existing requests: %s',
    async (url) => {
      for (const periodKey of [
        '2024-13',
        '2024-00',
        '2024-2',
        '1999-12',
        '2101-01',
        'not-a-month',
      ]) {
        await http().get(url).query({ period: 'MONTH', periodKey }).expect(400);
      }
      await http()
        .get(url)
        .query({ period: 'YEAR', periodKey: '2024-02' })
        .expect(400);
      await http().get(url).query({ period: 'MONTH' }).expect(200);
    },
  );
});
