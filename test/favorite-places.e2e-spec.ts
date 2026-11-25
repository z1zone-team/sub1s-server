import { randomUUID } from 'node:crypto';
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
import { PrismaService } from '../src/infra/prisma/prisma.service';

describe('Favorite places (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const tag = randomUUID().slice(0, 8);
  const me = {
    id: randomUUID(),
    clerkId: `e2e_fp_${tag}`,
    nickname: `fp_${tag}`,
  };
  const other = {
    id: randomUUID(),
    clerkId: `e2e_fp_o_${tag}`,
    nickname: `fp_o_${tag}`,
  };
  let currentUser = me;

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

  const URL = '/api/v1/users/me/favorites/places';
  const list = () => request(app.getHttpServer()).get(URL);
  const save = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).put(URL).send(body);
  const remove = (id: string) =>
    request(app.getHttpServer()).delete(`${URL}/${id}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ClerkAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = { ...currentUser };
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
    await prisma.user.createMany({ data: [me, other] });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [me.id, other.id] } } });
    await app.close();
  });

  beforeEach(async () => {
    currentUser = me;
    await prisma.userFavoritePlace.deleteMany({
      where: { userId: { in: [me.id, other.id] } },
    });
  });

  it('starts empty and reports the limit', async () => {
    const res = await list().expect(200);
    expect(res.body.data).toEqual({ places: [], limit: 20 });
  });

  it('saves a station and a place, newest first', async () => {
    const station = await save({ name: '가양역', stationId: '09_907' }).expect(
      200,
    );
    expect(station.body.data).toMatchObject({
      name: '가양역',
      stationId: '09_907',
      lat: null,
      lng: null,
      alreadySaved: false,
    });
    expect(station.body.data.createdAt).toMatch(/\+09:00$/);

    await save({ name: '서울시청', lat: 37.5665, lng: 126.978 }).expect(200);

    const res = await list().expect(200);
    expect(res.body.data.places.map((p: { name: string }) => p.name)).toEqual([
      '서울시청',
      '가양역',
    ]);
  });

  it('does not save the same place twice, even with a different name or a tiny coordinate change', async () => {
    const first = await save({ name: '시청', lat: 37.5665, lng: 126.978 });
    const second = await save({
      name: '서울시청',
      lat: 37.56650004,
      lng: 126.97800002,
    }).expect(200);

    expect(second.body.data).toMatchObject({
      id: first.body.data.id,
      name: '시청',
      alreadySaved: true,
    });
    expect((await list()).body.data.places).toHaveLength(1);
  });

  it('keeps each user own places apart and removes only the own place', async () => {
    const mine = await save({ name: '가양역', stationId: '09_907' });

    currentUser = other;
    expect((await list()).body.data.places).toEqual([]);
    const notMine = await remove(mine.body.data.id).expect(200);
    expect(notMine.body.data.removed).toBe(false);

    currentUser = me;
    const removed = await remove(mine.body.data.id).expect(200);
    expect(removed.body.data.removed).toBe(true);
    expect((await list()).body.data.places).toEqual([]);
  });

  it('answers 400 for a place with neither a station nor coordinates, an unknown field or a bad id', async () => {
    await save({ name: '어딘가' }).expect(400);
    await save({ name: '가양역', stationId: '09_907', memo: 'x' }).expect(400);
    await remove('not-a-uuid').expect(400);
  });

  it('answers 404 for a station that does not exist', async () => {
    const res = await save({ name: '없는역', stationId: '99_999' }).expect(404);
    expect(res.body.error.code).toBe('STATION_NOT_FOUND');
  });

  it('answers 409 once 20 places are saved, but still returns an existing one', async () => {
    await prisma.userFavoritePlace.createMany({
      data: Array.from({ length: 20 }, (_, index) => ({
        userId: me.id,
        placeKey: `P:37.${String(1000 + index)},127.0000`,
        name: `장소${index}`,
        lat: 37.1 + index / 10000,
        lng: 127,
      })),
    });

    const res = await save({ name: '가양역', stationId: '09_907' }).expect(409);
    expect(res.body.error.code).toBe('FAVORITE_PLACE_LIMIT');

    const existing = await save({ name: '장소0', lat: 37.1, lng: 127 }).expect(
      200,
    );
    expect(existing.body.data.alreadySaved).toBe(true);
  });
});
