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

describe('Favorite routes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const tag = randomUUID().slice(0, 8);
  const me = { id: randomUUID(), clerkId: `e2e_fav_${tag}`, nickname: `fav_${tag}` };
  const other = { id: randomUUID(), clerkId: `e2e_fav_o_${tag}`, nickname: `fav_o_${tag}` };
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

  const URL = '/api/v1/users/me/favorites/routes';
  const list = () => request(app.getHttpServer()).get(URL);
  const save = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).put(URL).send(body);
  const remove = (id: string) => request(app.getHttpServer()).delete(`${URL}/${id}`);
  const station = (name: string, stationId: string) => ({ name, stationId });

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
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
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
    await prisma.userFavoriteRoute.deleteMany({ where: { userId: { in: [me.id, other.id] } } });
  });

  it('starts empty and reports the limit', async () => {
    const res = await list().expect(200);

    expect(res.body.data).toEqual({ favorites: [], limit: 20 });
  });

  it('saves a station route and lists it', async () => {
    const saved = await save({
      origin: station('가양', '09_907'),
      destination: station('신논현', '09_925'),
    }).expect(200);

    expect(saved.body.data).toMatchObject({
      origin: { name: '가양', stationId: '09_907', lat: null, lng: null },
      destination: { name: '신논현', stationId: '09_925' },
      alreadySaved: false,
    });
    expect(saved.body.data.id).toEqual(expect.any(String));

    const res = await list().expect(200);
    expect(res.body.data.favorites).toHaveLength(1);
    expect(res.body.data.favorites[0].id).toBe(saved.body.data.id);
  });

  it('saves a place by coordinates', async () => {
    const res = await save({
      origin: { name: '우리집', lat: 37.5665, lng: 126.978 },
      destination: station('신논현', '09_925'),
    }).expect(200);

    expect(res.body.data.origin).toEqual({
      name: '우리집',
      stationId: null,
      lat: 37.5665,
      lng: 126.978,
    });
  });

  it('does not save the same route twice, even with a different name', async () => {
    const first = await save({
      origin: station('가양', '09_907'),
      destination: station('신논현', '09_925'),
    }).expect(200);
    const again = await save({
      origin: station('가양역', '09_907'),
      destination: station('신논현역', '09_925'),
    }).expect(200);

    expect(again.body.data.id).toBe(first.body.data.id);
    expect(again.body.data.alreadySaved).toBe(true);
    expect((await list()).body.data.favorites).toHaveLength(1);
  });

  it('treats the reverse direction as a different route', async () => {
    await save({ origin: station('가양', '09_907'), destination: station('신논현', '09_925') }).expect(200);
    await save({ origin: station('신논현', '09_925'), destination: station('가양', '09_907') }).expect(200);

    expect((await list()).body.data.favorites).toHaveLength(2);
  });

  it('lists the most recently saved first', async () => {
    await save({ origin: station('가양', '09_907'), destination: station('신논현', '09_925') }).expect(200);
    const second = await save({
      origin: station('강남', '02_222'),
      destination: station('신논현', '09_925'),
    }).expect(200);

    const res = await list().expect(200);
    expect(res.body.data.favorites[0].id).toBe(second.body.data.id);
  });

  it('keeps each user own favorites apart', async () => {
    await save({ origin: station('가양', '09_907'), destination: station('신논현', '09_925') }).expect(200);

    currentUser = other;
    expect((await list()).body.data.favorites).toEqual([]);
    // 다른 사용자도 같은 경로를 따로 저장할 수 있다
    const theirs = await save({
      origin: station('가양', '09_907'),
      destination: station('신논현', '09_925'),
    }).expect(200);
    expect(theirs.body.data.alreadySaved).toBe(false);
  });

  it('removes only the own favorite', async () => {
    const saved = await save({
      origin: station('가양', '09_907'),
      destination: station('신논현', '09_925'),
    }).expect(200);

    currentUser = other;
    const theirAttempt = await remove(saved.body.data.id).expect(200);
    expect(theirAttempt.body.data.removed).toBe(false);

    currentUser = me;
    expect((await list()).body.data.favorites).toHaveLength(1);
    const own = await remove(saved.body.data.id).expect(200);
    expect(own.body.data).toEqual({ id: saved.body.data.id, removed: true });
    expect((await list()).body.data.favorites).toEqual([]);
  });

  it('answers removed false for an id that does not exist', async () => {
    const res = await remove(randomUUID()).expect(200);

    expect(res.body.data.removed).toBe(false);
  });

  it('answers 400 for an id that is not a uuid', async () => {
    await remove('not-a-uuid').expect(400);
  });

  it('answers 400 when an endpoint has neither a station nor coordinates', async () => {
    await save({ origin: { name: '어딘가' }, destination: station('신논현', '09_925') }).expect(400);
  });

  it('answers 400 when the origin and destination are the same', async () => {
    await save({ origin: station('가양', '09_907'), destination: station('가양역', '09_907') }).expect(400);
  });

  it('answers 400 for an unknown field', async () => {
    await save({
      origin: station('가양', '09_907'),
      destination: station('신논현', '09_925'),
      extra: true,
    }).expect(400);
  });

  it('answers 404 for a station that does not exist', async () => {
    const res = await save({
      origin: station('없는역', '99_999'),
      destination: station('신논현', '09_925'),
    }).expect(404);

    expect(res.body.error.code).toBe('STATION_NOT_FOUND');
  });

  it('answers 409 once 20 favorites are saved, but still returns an existing one', async () => {
    await prisma.userFavoriteRoute.createMany({
      data: Array.from({ length: 20 }, (_, index) => ({
        userId: me.id,
        routeKey: `P:37.${String(1000 + index)},127.0000>S:09_925`,
        originName: `집${index}`,
        originLat: 37.1 + index / 10000,
        originLng: 127,
        destinationName: '신논현',
        destinationStationId: '09_925',
      })),
    });

    const res = await save({
      origin: station('가양', '09_907'),
      destination: station('신논현', '09_925'),
    }).expect(409);
    expect(res.body.error.code).toBe('FAVORITE_ROUTE_LIMIT');

    // 이미 저장된 경로는 한도와 상관없이 그대로 돌려준다
    const existing = await save({
      origin: { name: '집0', lat: 37.1, lng: 127 },
      destination: station('신논현', '09_925'),
    });
    expect(existing.status).toBe(200);
    expect(existing.body.data.alreadySaved).toBe(true);
  });

  it('deletes the favorites together with the user', async () => {
    const ghost = { id: randomUUID(), clerkId: `e2e_fav_g_${tag}`, nickname: `fav_g_${tag}` };
    await prisma.user.create({ data: ghost });
    await prisma.userFavoriteRoute.create({
      data: {
        userId: ghost.id,
        routeKey: 'S:09_907>S:09_925',
        originName: '가양',
        originStationId: '09_907',
        destinationName: '신논현',
        destinationStationId: '09_925',
      },
    });

    await prisma.user.delete({ where: { id: ghost.id } });

    expect(await prisma.userFavoriteRoute.count({ where: { userId: ghost.id } })).toBe(0);
  });
});
