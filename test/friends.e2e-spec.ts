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

describe('Friends and friends-only ranking (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const tag = randomUUID().slice(0, 8);
  const periodKey = `e2e-friends-${tag}`;
  const mk = (name: string) => ({
    id: randomUUID(),
    clerkId: `e2e_${name}_${tag}`,
    nickname: `${name}_${tag}`,
  });
  const me = mk('me');
  const friend = mk('friend');
  const anonFriend = mk('anon');
  const privateFriend = mk('priv');
  const stranger = mk('stranger');
  const everyone = [me, friend, anonFriend, privateFriend, stranger];
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

  const http = () => request(app.getHttpServer());
  const as = (user: typeof me) => {
    currentUser = user;
  };
  const inviteTokenOf = async (user: typeof me) => {
    as(user);
    return (await http().get('/api/v1/friends/invite').expect(200)).body.data.inviteToken as string;
  };
  const accept = (inviteToken: string) =>
    http().post('/api/v1/friends/accept').send({ inviteToken });
  const ranking = (friendsOnly: boolean) =>
    http().get('/api/v1/ranking').query({ periodType: 'MONTHLY', periodKey, friendsOnly });

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
    await prisma.user.createMany({
      data: everyone.map((user) => ({
        ...user,
        rankingVisibility:
          user === anonFriend ? 'ANONYMOUS' : user === privateFriend ? 'PRIVATE' : 'PUBLIC',
      })),
    });
    await prisma.rankScore.createMany({
      data: [
        [stranger, 500],
        [friend, 400],
        [me, 300],
        [anonFriend, 200],
        [privateFriend, 100],
      ].map(([user, totalPoints]) => ({
        userId: (user as typeof me).id,
        periodType: 'MONTHLY',
        periodKey,
        totalPoints: totalPoints as number,
        totalDistanceKm: 1,
      })),
    });
  });

  afterAll(async () => {
    await prisma.rankScore.deleteMany({ where: { periodKey } });
    await prisma.user.deleteMany({ where: { id: { in: everyone.map((user) => user.id) } } });
    await app.close();
  });

  beforeEach(() => as(me));

  it('issues a stable invite token and replaces it on reset', async () => {
    const first = await inviteTokenOf(me);
    const again = await inviteTokenOf(me);

    expect(first).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(again).toBe(first);

    const reset = (await http().post('/api/v1/friends/invite/reset').expect(201)).body.data
      .inviteToken;
    expect(reset).not.toBe(first);
    expect(await inviteTokenOf(me)).toBe(reset);
    await accept(first).expect(404);
  });

  it('rejects your own token and an unknown token', async () => {
    const own = await inviteTokenOf(me);

    const self = await accept(own).expect(400);
    expect(self.body.error.code).toBe('SELF_INVITE');
    await accept('NoSuchToken00000').expect(404);
    await http().post('/api/v1/friends/accept').send({ inviteToken: '짧' }).expect(400);
  });

  it('makes both users friends when a token is accepted, and accepting twice is harmless', async () => {
    const token = await inviteTokenOf(friend);
    as(me);

    const first = await accept(token).expect(201);
    expect(first.body.data).toMatchObject({ userId: friend.id, nickname: friend.nickname });
    expect(first.body.data.friendedAt).toMatch(/\+09:00$/);
    const second = await accept(token).expect(201);
    expect(second.body.data.userId).toBe(friend.id);

    const mine = (await http().get('/api/v1/friends').expect(200)).body.data;
    expect(mine.totalCount).toBe(1);
    expect(mine.friends[0].userId).toBe(friend.id);

    as(friend);
    const theirs = (await http().get('/api/v1/friends').expect(200)).body.data;
    expect(theirs.friends.map((item: { userId: string }) => item.userId)).toEqual([me.id]);
    expect(await prisma.friendship.count({ where: { OR: [{ userId: me.id }, { friendId: me.id }] } })).toBe(2);
  });

  describe('friends-only ranking', () => {
    beforeAll(async () => {
      for (const other of [anonFriend, privateFriend]) {
        const token = await inviteTokenOf(other);
        as(me);
        await accept(token);
      }
    });

    it('lists the whole ranking when friendsOnly is false, with strings parsed correctly', async () => {
      const res = await ranking(false).expect(200);

      expect(res.body.data.friendsOnly).toBe(false);
      expect(res.body.data.totalUsers).toBe(4);
      expect(res.body.data.leaderboard.some((item: { userId?: string }) => item.userId === stranger.id)).toBe(true);
    });

    it('keeps only me and my friends, shows an anonymous friend by nickname and hides a private friend', async () => {
      const res = await ranking(true).expect(200);
      const board = res.body.data.leaderboard as { userId?: string; nickname: string; isMe: boolean }[];

      expect(res.body.data.friendsOnly).toBe(true);
      expect(board.map((item) => item.userId)).toEqual([friend.id, me.id, anonFriend.id]);
      expect(board[2].nickname).toBe(anonFriend.nickname);
      expect(res.body.data.myRank).toBe(2);
      expect(res.body.data.totalUsers).toBe(3);
      expect(JSON.stringify(res.body)).not.toContain(stranger.id);
      expect(JSON.stringify(res.body)).not.toContain(privateFriend.id);
    });

    it('shows the anonymous user as anonymous to a non-friend in the full ranking', async () => {
      as(stranger);

      const res = await ranking(false).expect(200);

      expect(res.body.data.leaderboard.find((item: { nickname: string }) => item.nickname === '익명')).toBeDefined();
      expect(JSON.stringify(res.body)).not.toContain(anonFriend.id);
    });
  });

  it('removes the friendship for both users and 404s for a non-friend', async () => {
    await http().delete(`/api/v1/friends/${friend.id}`).expect(200);

    const mine = (await http().get('/api/v1/friends').expect(200)).body.data;
    expect(mine.friends.map((item: { userId: string }) => item.userId)).not.toContain(friend.id);
    as(friend);
    const theirs = (await http().get('/api/v1/friends').expect(200)).body.data;
    expect(theirs.friends).toEqual([]);

    as(me);
    await http().delete(`/api/v1/friends/${friend.id}`).expect(404);
    await http().delete('/api/v1/friends/not-a-uuid').expect(400);
  });

  it('removes the friendships when a user is deleted', async () => {
    const doomed = mk('doomed');
    await prisma.user.create({ data: doomed });
    await prisma.friendship.createMany({
      data: [
        { userId: me.id, friendId: doomed.id },
        { userId: doomed.id, friendId: me.id },
      ],
    });

    await prisma.user.delete({ where: { id: doomed.id } });

    expect(await prisma.friendship.count({ where: { OR: [{ userId: doomed.id }, { friendId: doomed.id }] } })).toBe(0);
  });
});
