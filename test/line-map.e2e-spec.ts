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

describe('Line map visited stations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const tag = randomUUID().slice(0, 8);
  const me = { id: randomUUID(), clerkId: `e2e_linemap_${tag}`, nickname: `lm_${tag}` };
  const origin = '02_224';
  const dest = '02_221';
  const dataDir = resolve(__dirname, '../src/data/subway');
  const read = (name: string) => JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8'));
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
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);

    const stations = (read('stations.json') as Prisma.StationCreateManyInput[]).filter((s) =>
      [origin, dest].includes(s.id),
    );
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
      data: createdLineIds.map((id) => ({ id, lineName: `e2e-${id}`, colorHex: '#000000' })),
    });
    await prisma.station.createMany({
      data: stations.filter((s) => createdStationIds.includes(s.id)),
    });
    await prisma.user.create({ data: me });
  });

  afterAll(async () => {
    await prisma.travelLog.deleteMany({ where: { userId: me.id } });
    await prisma.rankScore.deleteMany({ where: { userId: me.id } });
    await prisma.user.deleteMany({ where: { id: me.id } });
    await prisma.station.deleteMany({ where: { id: { in: createdStationIds } } });
    await prisma.subwayLine.deleteMany({ where: { id: { in: createdLineIds } } });
    await app.close();
  });

  it('marks every station the route passed as visited, not only the endpoints', async () => {
    const search = await http()
      .post('/api/v1/routes/search')
      .send({ originStationId: origin, destinationStationId: dest, routeMode: 'OPTIMAL' })
      .expect(200);
    const passed: string[] = search.body.data.options[0].stationIds;
    const between = passed.filter((id) => id !== origin && id !== dest);

    expect(passed[0]).toBe(origin);
    expect(passed[passed.length - 1]).toBe(dest);
    expect(between.length).toBeGreaterThan(0);

    await http()
      .post('/api/v1/travel/log')
      .send({ originStationId: origin, destStationId: dest })
      .expect(201);

    const map = await http().get('/api/v1/line-map').query({ period: 'ALL' }).expect(200);
    const visited = new Set<string>(
      map.body.data.lines.flatMap((line: { stations: { stationId: string; visited: boolean }[] }) =>
        line.stations.filter((s) => s.visited).map((s) => s.stationId),
      ),
    );

    for (const id of passed) expect(visited.has(id)).toBe(true);
    expect(visited.size).toBe(new Set(passed).size);
  });
});
