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

describe('Profile and ranking visibility (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const tag = randomUUID().slice(0, 8);
  const periodKey = `e2e-${tag}`;
  const me = { id: randomUUID(), clerkId: `e2e_me_${tag}`, nickname: `me_${tag}` };
  const other = { id: randomUUID(), clerkId: `e2e_other_${tag}`, nickname: `Other_${tag}` };
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

  const patchMe = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).patch('/api/v1/users/me').send(body);

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
    await prisma.rankScore.createMany({
      data: [
        { userId: me.id, periodType: 'MONTHLY', periodKey, totalPoints: 100, totalDistanceKm: 10 },
        { userId: other.id, periodType: 'MONTHLY', periodKey, totalPoints: 200, totalDistanceKm: 20 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.rankScore.deleteMany({ where: { periodKey } });
    await prisma.user.deleteMany({ where: { id: { in: [me.id, other.id] } } });
    await app.close();
  });

  beforeEach(() => {
    currentUser = me;
  });

  it('updates name, nickname and visibility and returns them', async () => {
    const res = await patchMe({
      name: '박지훈',
      nickname: `내출신_${tag}`,
      rankingVisibility: 'ANONYMOUS',
    }).expect(200);

    expect(res.body.data).toEqual({
      userId: me.id,
      name: '박지훈',
      nickname: `내출신_${tag}`,
      profileImageUrl: null,
      rankingVisibility: 'ANONYMOUS',
    });
    expect(res.body.timestamp).toMatch(/\+09:00$/);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    expect(stored.rankingVisibility).toBe('ANONYMOUS');
  });

  it('clears the name with null', async () => {
    await patchMe({ name: '임시' }).expect(200);

    const res = await patchMe({ name: null }).expect(200);

    expect(res.body.data.name).toBeNull();
  });

  it('rejects a nickname another user has, ignoring case', async () => {
    const res = await patchMe({ nickname: other.nickname.toUpperCase() }).expect(409);

    expect(res.body.error.code).toBe('NICKNAME_TAKEN');
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    expect(stored.nickname).not.toBe(other.nickname.toUpperCase());
  });

  it('lets a user change only the case of their own nickname', async () => {
    const current = (await prisma.user.findUniqueOrThrow({ where: { id: me.id } })).nickname;

    const res = await patchMe({ nickname: current.toUpperCase() }).expect(200);

    expect(res.body.data.nickname).toBe(current.toUpperCase());
  });

  it('treats an underscore in a nickname as a normal character, not a wildcard', async () => {
    await patchMe({ nickname: `OtherX${tag}` }).expect(200);
  });

  it.each([
    ['an empty body', {}],
    ['a short nickname', { nickname: 'a' }],
    ['a nickname with a space', { nickname: '내 출신' }],
    ['an unknown visibility', { rankingVisibility: 'FRIENDS' }],
    ['an empty name', { name: '' }],
    ['an unknown field', { nickname: 'valid_nick', admin: true }],
  ])('rejects %s with 400', async (_label, body) => {
    await patchMe(body).expect(400);
  });

  it('shows the name and visibility on GET /auth/me', async () => {
    await patchMe({ name: '박지훈', rankingVisibility: 'ANONYMOUS' }).expect(200);

    const res = await request(app.getHttpServer()).get('/api/v1/auth/me').expect(200);

    expect(res.body.data.name).toBe('박지훈');
    expect(res.body.data.rankingVisibility).toBe('ANONYMOUS');
    expect(res.body.data).not.toHaveProperty('isRankingPublic');
  });

  describe('ranking follows the visibility', () => {
    const ranking = () =>
      request(app.getHttpServer())
        .get('/api/v1/ranking')
        .query({ periodType: 'MONTHLY', periodKey });

    it('shows a public user with their identity', async () => {
      await prisma.user.update({ where: { id: other.id }, data: { rankingVisibility: 'PUBLIC' } });

      const res = await ranking().expect(200);

      expect(res.body.data.leaderboard[0]).toMatchObject({
        userId: other.id,
        nickname: other.nickname,
        isAnonymous: false,
      });
      expect(res.body.data.totalUsers).toBe(2);
    });

    it('masks an anonymous user', async () => {
      await prisma.user.update({ where: { id: other.id }, data: { rankingVisibility: 'ANONYMOUS' } });

      const res = await ranking().expect(200);

      const first = res.body.data.leaderboard[0];
      expect(first).toMatchObject({ rank: 1, nickname: '익명', totalPoints: 200, isAnonymous: true });
      expect(first).not.toHaveProperty('userId');
      expect(JSON.stringify(res.body)).not.toContain(other.id);
    });

    it('hides a private user from others and from the user count', async () => {
      await prisma.user.update({ where: { id: other.id }, data: { rankingVisibility: 'PRIVATE' } });

      const res = await ranking().expect(200);

      expect(res.body.data.leaderboard.map((item: { userId: string }) => item.userId)).toEqual([me.id]);
      expect(res.body.data.totalUsers).toBe(1);
      expect(JSON.stringify(res.body)).not.toContain(other.id);
    });

    it('still shows a private user their own rank', async () => {
      await prisma.user.update({ where: { id: other.id }, data: { rankingVisibility: 'PRIVATE' } });
      currentUser = other;

      const res = await ranking().expect(200);

      expect(res.body.data.myRank).toBe(1);
      expect(res.body.data.myPoints).toBe(200);
      expect(res.body.data.leaderboard[0]).toMatchObject({ userId: other.id, isMe: true });
    });
  });
});
