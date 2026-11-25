import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, RankingVisibility } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';
import { ClerkAuthGuard } from '../src/infra/auth/clerk-auth.guard';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { kstNowIso } from '../src/common/utils/kst';

describe('Other user travel history (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const tag = randomUUID().slice(0, 8);
  const mk = (
    name: string,
    rankingVisibility: RankingVisibility = 'PUBLIC',
  ) => ({
    id: randomUUID(),
    clerkId: `e2e_ut_${name}_${tag}`,
    nickname: `ut_${name}_${tag}`,
    rankingVisibility,
  });
  const me = mk('me');
  const publicUser = mk('public');
  const anonFriend = mk('anonfriend', 'ANONYMOUS');
  const anonStranger = mk('anonstranger', 'ANONYMOUS');
  const privateFriend = mk('privatefriend', 'PRIVATE');
  const privateStranger = mk('privatestranger', 'PRIVATE');
  const everyone = [
    me,
    publicUser,
    anonFriend,
    anonStranger,
    privateFriend,
    privateStranger,
  ];
  let current: { id: string; clerkId: string; nickname: string } = me;

  const origin = '02_224';
  const dest = '02_221';
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
  const [year, month] = kstNowIso().slice(0, 7).split('-').map(Number);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ClerkAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = { ...current };
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
    ).filter((s) => [origin, dest].includes(s.id));
    const existingStations = await prisma.station.findMany({
      where: { id: { in: stations.map((s) => s.id) } },
      select: { id: true },
    });
    const existingLines = await prisma.subwayLine.findMany({
      where: { id: { in: stations.map((s) => s.lineId) } },
      select: { id: true },
    });
    createdLineIds = [...new Set(stations.map((s) => s.lineId))].filter(
      (id) => !existingLines.some((line) => line.id === id),
    );
    createdStationIds = stations
      .map((s) => s.id)
      .filter((id) => !existingStations.some((station) => station.id === id));

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
    await prisma.user.createMany({ data: everyone });
    await prisma.friendship.createMany({
      data: [anonFriend, privateFriend].flatMap((friend) => [
        { userId: me.id, friendId: friend.id },
        { userId: friend.id, friendId: me.id },
      ]),
    });

    current = publicUser;
    await http()
      .post('/api/v1/travel/log')
      .send({ originStationId: origin, destStationId: dest })
      .expect(201);
    current = me;
  });

  afterAll(async () => {
    const ids = everyone.map((user) => user.id);
    await prisma.travelLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.rankScore.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.station.deleteMany({
      where: { id: { in: createdStationIds } },
    });
    await prisma.subwayLine.deleteMany({
      where: { id: { in: createdLineIds } },
    });
    await app.close();
  });

  it('returns the same shape as my own travel history for a public user', async () => {
    current = publicUser;
    const ownTimeline = (
      await http()
        .get('/api/v1/travel/timeline')
        .query({ year, month })
        .expect(200)
    ).body.data;
    const ownStats = (
      await http()
        .get('/api/v1/travel/stats')
        .query({ period: 'MONTH' })
        .expect(200)
    ).body.data;
    const ownMap = (
      await http()
        .get('/api/v1/travel/line-map')
        .query({ period: 'MONTH' })
        .expect(200)
    ).body.data;
    current = me;

    const base = `/api/v1/users/${publicUser.id}/travel`;
    const timeline = (
      await http().get(`${base}/timeline`).query({ year, month }).expect(200)
    ).body.data;
    const stats = (
      await http().get(`${base}/stats`).query({ period: 'MONTH' }).expect(200)
    ).body.data;
    const map = (
      await http()
        .get(`${base}/line-map`)
        .query({ period: 'MONTH' })
        .expect(200)
    ).body.data;

    expect(timeline).toEqual({ userId: publicUser.id, ...ownTimeline });
    expect(timeline.totalLogsCount).toBe(1);
    expect(stats).toEqual(ownStats);
    expect(map).toEqual(ownMap);
  });

  it('lets a friend see an anonymous user but not a stranger', async () => {
    await http()
      .get(`/api/v1/users/${anonFriend.id}/travel/stats`)
      .query({ period: 'ALL' })
      .expect(200);

    const res = await http()
      .get(`/api/v1/users/${anonStranger.id}/travel/stats`)
      .query({ period: 'ALL' })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN_TRAVEL_HISTORY');
  });

  it('lets a friend see a private user but not a stranger', async () => {
    await http()
      .get(`/api/v1/users/${privateFriend.id}/travel/line-map`)
      .query({ period: 'ALL' })
      .expect(200);

    await http()
      .get(`/api/v1/users/${privateStranger.id}/travel/line-map`)
      .query({ period: 'ALL' })
      .expect(403);
  });

  it('404s for an unknown user and 400s for a malformed id', async () => {
    const res = await http()
      .get(`/api/v1/users/${randomUUID()}/travel/timeline`)
      .query({ year, month })
      .expect(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');

    await http()
      .get('/api/v1/users/not-a-uuid/travel/timeline')
      .query({ year, month })
      .expect(400);
  });
});
