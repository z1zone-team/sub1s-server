import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { SettlementService } from '../src/application/notification/settlement.service';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PushMessage, PushResult } from '../src/domain/notification/models/push';
import { PUSH_SENDER } from '../src/domain/notification/ports/notification-ports';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';
import { ClerkAuthGuard } from '../src/infra/auth/clerk-auth.guard';
import { PrismaService } from '../src/infra/prisma/prisma.service';

describe('Push tokens, notification settings and monthly settlement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const tag = randomUUID().slice(0, 8);
  const mk = (name: string, rankingVisibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC') => ({
    id: randomUUID(),
    clerkId: `e2e_push_${name}_${tag}`,
    nickname: `push_${name}_${tag}`,
    rankingVisibility,
  });
  const tok = (name: string) => `ExponentPushToken[${name}${tag}xxxxxxxxxxxx]`;

  const active = mk('active');
  const optedOut = mk('optout');
  const noDevice = mk('nodev');
  const lastMonthOnly = mk('aug');
  const privateUser = mk('priv', 'PRIVATE');
  const other = mk('other');
  const everyone = [active, optedOut, noDevice, lastMonthOnly, privateUser, other];
  let currentUser = active;

  const origin = '02_224';
  const dest = '02_221';
  const dataDir = resolve(__dirname, '../src/data/subway');
  const read = (name: string) => JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8'));
  let createdStationIds: string[] = [];
  let createdLineIds: string[] = [];

  const sent: PushMessage[] = [];
  let deadTokens = new Set<string>();
  const fakeSender = {
    send: async (messages: PushMessage[]): Promise<PushResult[]> => {
      sent.push(...messages);
      return messages.map((m) => ({
        token: m.token,
        ok: !deadTokens.has(m.token),
        invalidToken: deadTokens.has(m.token),
      }));
    },
  };

  const mockGraphRepository: ISubwayGraphRepository = {
    loadGraphData: async () => ({
      stations: read('stations.json'),
      edges: read('edges.json'),
      transfers: read('transfers.json'),
    }),
  };

  const http = () => request(app.getHttpServer());
  const put = (body: Record<string, unknown>) => http().put('/api/v1/users/me/push-tokens').send(body);

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
      .overrideProvider(PUSH_SENDER)
      .useValue(fakeSender)
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
    await prisma.user.createMany({ data: everyone });
  });

  afterAll(async () => {
    const userIds = everyone.map((u) => u.id);
    await prisma.travelLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.rankScore.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.station.deleteMany({ where: { id: { in: createdStationIds } } });
    await prisma.subwayLine.deleteMany({ where: { id: { in: createdLineIds } } });
    await app.close();
  });

  beforeEach(() => {
    currentUser = active;
  });

  describe('push tokens', () => {
    it('registers a token and keeps one row when the same device registers again', async () => {
      await put({ token: tok('one'), platform: 'ios' }).expect(200);
      await put({ token: tok('one'), platform: 'android' }).expect(200);

      const rows = await prisma.pushToken.findMany({ where: { token: tok('one') } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: active.id, provider: 'EXPO', platform: 'android' });
    });

    it('moves a token to the user who registers it last, so a shared device follows the login', async () => {
      currentUser = other;
      await put({ token: tok('one') }).expect(200);

      const rows = await prisma.pushToken.findMany({ where: { token: tok('one') } });
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(other.id);
    });

    it('keeps only the ten newest tokens of a user', async () => {
      currentUser = lastMonthOnly;
      for (let i = 0; i < 12; i += 1) await put({ token: tok(`dev${i}`) }).expect(200);

      const rows = await prisma.pushToken.findMany({ where: { userId: lastMonthOnly.id } });
      expect(rows).toHaveLength(10);
      expect(rows.map((r) => r.token)).toContain(tok('dev11'));
    });

    it.each([
      ['a token with the wrong format', { token: 'abc' }, 'INVALID_PUSH_TOKEN'],
      ['an FCM token, which the server cannot send to yet', { token: 'ExponentPushToken[a]', provider: 'FCM' }, 'UNSUPPORTED_PUSH_PROVIDER'],
    ])('rejects %s with 400', async (_name, body, code) => {
      const res = await put(body).expect(400);

      expect(res.body.error.code).toBe(code);
    });

    it('rejects a missing token and unknown fields with 400', async () => {
      await put({}).expect(400);
      await put({ token: tok('x'), extra: 1 }).expect(400);
      await put({ token: tok('x'), platform: 'web' }).expect(400);
    });

    it('removes a token and answers removed=false the second time', async () => {
      currentUser = other;
      const url = `/api/v1/users/me/push-tokens?token=${encodeURIComponent(tok('one'))}`;

      expect((await http().delete(url).expect(200)).body.data).toEqual({ removed: true });
      expect((await http().delete(url).expect(200)).body.data).toEqual({ removed: false });
    });

    it('does not remove somebody else token', async () => {
      await put({ token: tok('mine') }).expect(200);
      currentUser = other;

      const res = await http().delete(`/api/v1/users/me/push-tokens?token=${encodeURIComponent(tok('mine'))}`).expect(200);

      expect(res.body.data).toEqual({ removed: false });
      expect(await prisma.pushToken.count({ where: { token: tok('mine') } })).toBe(1);
    });
  });

  describe('notification settings', () => {
    it('is on by default without creating a row', async () => {
      currentUser = other;

      const res = await http().get('/api/v1/users/me/notification-settings').expect(200);

      expect(res.body.data).toEqual({ monthlySettlement: true });
      expect(await prisma.userNotificationSetting.count({ where: { userId: other.id } })).toBe(0);
    });

    it('turns the monthly settlement off and on and remembers it', async () => {
      const off = await http().patch('/api/v1/users/me/notification-settings').send({ monthlySettlement: false }).expect(200);
      expect(off.body.data).toEqual({ monthlySettlement: false });
      expect((await http().get('/api/v1/users/me/notification-settings').expect(200)).body.data).toEqual({
        monthlySettlement: false,
      });

      await http().patch('/api/v1/users/me/notification-settings').send({ monthlySettlement: true }).expect(200);
      expect((await http().get('/api/v1/users/me/notification-settings').expect(200)).body.data.monthlySettlement).toBe(true);
    });

    it('rejects an empty or invalid update with 400', async () => {
      await http().patch('/api/v1/users/me/notification-settings').send({}).expect(400);
      await http().patch('/api/v1/users/me/notification-settings').send({ monthlySettlement: 'no' }).expect(400);
      await http().patch('/api/v1/users/me/notification-settings').send({ other: true }).expect(400);
    });
  });

  describe('monthly settlement', () => {
    const DUE = Date.parse('2026-10-01T09:00:00+09:00');
    const trip = (userId: string, at: string, distance = 10) => ({
      userId,
      originStationId: origin,
      destStationId: dest,
      totalDistanceKm: distance,
      transferCount: 0,
      earnedPoints: 100,
      createdAt: new Date(`${at}+09:00`),
    });
    const settlement = () => app.get(SettlementService);
    const messagesOf = (token: string) => sent.filter((m) => m.token === token);

    beforeAll(async () => {
      await prisma.travelLog.createMany({
        data: [
          trip(active.id, '2026-09-01T00:00:00', 10),
          trip(active.id, '2026-09-30T23:59:59', 20.25),
          trip(active.id, '2026-10-01T00:00:00', 99),
          trip(active.id, '2026-08-31T23:59:59', 99),
          trip(optedOut.id, '2026-09-10T10:00:00'),
          trip(noDevice.id, '2026-09-10T10:00:00'),
          trip(lastMonthOnly.id, '2026-08-20T10:00:00'),
          trip(privateUser.id, '2026-09-15T10:00:00', 5),
        ],
      });
      await prisma.rankScore.createMany({
        data: [
          { userId: active.id, periodType: 'MONTHLY', periodKey: '2026-09', totalPoints: 900_100, totalDistanceKm: 30 },
          { userId: privateUser.id, periodType: 'MONTHLY', periodKey: '2026-09', totalPoints: 900_050, totalDistanceKm: 5 },
          { userId: optedOut.id, periodType: 'MONTHLY', periodKey: '2026-09', totalPoints: 900_000, totalDistanceKm: 10 },
        ],
      });
      await prisma.userNotificationSetting.create({ data: { userId: optedOut.id, monthlySettlement: false } });
      await prisma.pushToken.createMany({
        data: [
          { userId: active.id, token: tok('act1') },
          { userId: active.id, token: tok('act2') },
          { userId: active.id, token: tok('dead') },
          { userId: optedOut.id, token: tok('opt') },
          { userId: privateUser.id, token: tok('priv') },
          { userId: lastMonthOnly.id, token: tok('aug') },
        ],
      });
      deadTokens = new Set([tok('dead')]);
    });

    it('does nothing before the first of the month at 9 AM KST', async () => {
      const report = await settlement().runIfDue(Date.parse('2026-10-01T08:59:00+09:00'));

      expect(report.status).toBe('NOT_DUE');
      expect(sent).toHaveLength(0);
    });

    it('counts the trips of the previous KST month only, sums the distance, and shows the rank', async () => {
      const report = await settlement().runIfDue(DUE);

      expect(report).toMatchObject({ status: 'DONE', periodKey: '2026-09', delivered: 2 });
      const [first] = messagesOf(tok('act1'));
      expect(first).toMatchObject({
        title: '9월 이동 정산',
        body: '2번 이동해 30.3km를 달렸어요 · 랭킹 1위',
        data: { type: 'MONTHLY_SETTLEMENT', periodKey: '2026-09', screen: 'timeline' },
        channelId: 'subway-settlement',
      });
      expect(messagesOf(tok('act2'))).toHaveLength(1);
    });

    it('shows a private user their own place, counting only public users above them', async () => {
      const [message] = messagesOf(tok('priv'));

      expect(message.body).toBe('1번 이동해 5.0km를 달렸어요 · 랭킹 2위');
    });

    it('skips users who opted out, have no device, or only travelled in another month', () => {
      expect(messagesOf(tok('opt'))).toHaveLength(0);
      expect(messagesOf(tok('aug'))).toHaveLength(0);
    });

    it('records who was handled and removes the token the device gave up', async () => {
      const rows = await prisma.settlementNotification.findMany({
        where: { userId: { in: everyone.map((u) => u.id) }, periodKey: '2026-09' },
      });

      expect(rows.map((r) => r.userId).sort()).toEqual([active.id, privateUser.id].sort());
      expect(rows.every((r) => r.status === 'SENT')).toBe(true);
      expect(await prisma.pushToken.count({ where: { token: tok('dead') } })).toBe(0);
      expect(await prisma.pushToken.count({ where: { token: tok('act1') } })).toBe(1);
    });

    it('sends nothing the second time, so a restart or the catch-up window cannot send twice', async () => {
      const before = sent.length;

      const report = await settlement().runIfDue(Date.parse('2026-10-02T12:00:00+09:00'));

      expect(report).toMatchObject({ status: 'DONE', attempted: 0 });
      expect(sent).toHaveLength(before);
    });

    it('stops after the catch-up window', async () => {
      const report = await settlement().runIfDue(Date.parse('2026-10-04T09:00:00+09:00'));

      expect(report.status).toBe('NOT_DUE');
    });

    it('marks a user failed when every device fails, and does not retry', async () => {
      const unlucky = mk('unlucky');
      await prisma.user.create({ data: unlucky });
      await prisma.travelLog.create({ data: trip(unlucky.id, '2026-09-05T10:00:00') });
      await prisma.pushToken.create({ data: { userId: unlucky.id, token: tok('unl') } });
      deadTokens.add(tok('unl'));
      try {
        const report = await settlement().runIfDue(DUE);
        expect(report).toMatchObject({ attempted: 1, delivered: 0, failed: 1, removedTokens: 1 });

        const row = await prisma.settlementNotification.findUnique({
          where: { userId_periodKey: { userId: unlucky.id, periodKey: '2026-09' } },
        });
        expect(row?.status).toBe('FAILED');

        const again = await settlement().runIfDue(DUE);
        expect(again.attempted).toBe(0);
      } finally {
        await prisma.travelLog.deleteMany({ where: { userId: unlucky.id } });
        await prisma.user.delete({ where: { id: unlucky.id } });
      }
    });
  });
});
