import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';
import { ClerkAuthGuard } from '../src/infra/auth/clerk-auth.guard';
import { PrismaService } from '../src/infra/prisma/prisma.service';

interface FrequentRoute {
  originStationId: string;
  originStationName: string;
  destStationId: string;
  tripCount: number;
  lastTraveledAt: string;
}

describe('Frequent routes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const tag = randomUUID().slice(0, 8);
  const me = {
    id: randomUUID(),
    clerkId: `e2e_fr_me_${tag}`,
    nickname: `fr_me_${tag}`,
  };
  const other = {
    id: randomUUID(),
    clerkId: `e2e_fr_other_${tag}`,
    nickname: `fr_other_${tag}`,
  };

  const stationIds = ['02_222', '02_221', '02_224'];
  const dataDir = resolve(__dirname, '../src/data/subway');
  const read = (name: string) =>
    JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8'));
  let createdStationIds: string[] = [];
  let createdLineIds: string[] = [];

  const mockGraphRepository: ISubwayGraphRepository = {
    loadGraphData: async () => ({
      stations: read('stations.json'),
      edges: read('edges.json'),
      transfers: read('transfers.json'),
    }),
  };

  const http = () => request(app.getHttpServer());
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
  const log = (
    userId: string,
    originStationId: string,
    destStationId: string,
    createdAt: Date,
  ): Prisma.TravelLogCreateManyInput => ({
    userId,
    originStationId,
    destStationId,
    totalDistanceKm: 1,
    transferCount: 0,
    earnedPoints: 10,
    createdAt,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ClerkAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = { ...me };
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
    await app.init();
    prisma = app.get(PrismaService);

    const stations = (
      read('stations.json') as Prisma.StationCreateManyInput[]
    ).filter((s) => stationIds.includes(s.id));
    const existingStations = await prisma.station.findMany({
      where: { id: { in: stationIds } },
      select: { id: true },
    });
    const existingLines = await prisma.subwayLine.findMany({
      where: { id: { in: stations.map((s) => s.lineId) } },
      select: { id: true },
    });
    createdLineIds = [...new Set(stations.map((s) => s.lineId))].filter(
      (id) => !existingLines.some((line) => line.id === id),
    );
    createdStationIds = stationIds.filter(
      (id) => !existingStations.some((station) => station.id === id),
    );
    await prisma.subwayLine.createMany({
      data: createdLineIds.map((id) => ({
        id,
        lineName: `e2e-${id}`,
        colorHex: '#000000',
      })),
    });
    await prisma.station.createMany({
      data: stations.filter((s) => createdStationIds.includes(s.id)),
    });
    await prisma.user.createMany({ data: [me, other] });

    await prisma.travelLog.createMany({
      data: [
        // 3번 다닌 경로
        log(me.id, '02_222', '02_221', daysAgo(1)),
        log(me.id, '02_222', '02_221', daysAgo(3)),
        log(me.id, '02_222', '02_221', daysAgo(5)),
        // 2번 다닌 경로
        log(me.id, '02_221', '02_224', daysAgo(2)),
        log(me.id, '02_221', '02_224', daysAgo(4)),
        // 한 번만 다닌 경로
        log(me.id, '02_224', '02_222', daysAgo(1)),
        // 기본 기간(30일) 밖
        log(me.id, '02_224', '02_221', daysAgo(40)),
        log(me.id, '02_224', '02_221', daysAgo(41)),
        // 다른 사용자의 기록
        log(other.id, '02_224', '02_222', daysAgo(1)),
        log(other.id, '02_224', '02_222', daysAgo(2)),
      ],
    });
  });

  afterAll(async () => {
    const ids = [me.id, other.id];
    await prisma.travelLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.station.deleteMany({
      where: { id: { in: createdStationIds } },
    });
    await prisma.subwayLine.deleteMany({
      where: { id: { in: createdLineIds } },
    });
    await app.close();
  });

  it('returns my routes taken at least twice, most trips first', async () => {
    const res = await http().get('/api/v1/travel/frequent-routes').expect(200);
    const routes = res.body.data.routes as FrequentRoute[];

    expect(res.body.data.since).toMatch(/T00:00:00\.000\+09:00$/);
    expect(
      routes.map((r) => [r.originStationId, r.destStationId, r.tripCount]),
    ).toEqual([
      ['02_222', '02_221', 3],
      ['02_221', '02_224', 2],
    ]);
    expect(routes[0].originStationName).toBeTruthy();
    expect(routes[0].lastTraveledAt).toMatch(/\+09:00$/);
  });

  it('honors limit and a longer window', async () => {
    const limited = await http()
      .get('/api/v1/travel/frequent-routes')
      .query({ limit: 1 })
      .expect(200);
    expect(limited.body.data.routes).toHaveLength(1);

    const longer = await http()
      .get('/api/v1/travel/frequent-routes')
      .query({ days: 90 })
      .expect(200);
    expect(longer.body.data.routes).toHaveLength(3);
  });

  it('rejects out of range parameters', async () => {
    await http()
      .get('/api/v1/travel/frequent-routes')
      .query({ days: 91 })
      .expect(400);
    await http()
      .get('/api/v1/travel/frequent-routes')
      .query({ limit: 0 })
      .expect(400);
  });
});
