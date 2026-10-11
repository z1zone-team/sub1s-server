import { PushMessage, PushResult } from '../../domain/notification/models/push';
import {
  INotificationSettingsRepository,
  IPushSender,
  IPushTokenRepository,
  ISettlementLogRepository,
} from '../../domain/notification/ports/notification-ports';
import { IRankScoreRepository } from '../../domain/ranking/ports/IRankScoreRepository';
import { ITravelLogRepository } from '../../domain/travel/ports/ITravelLogRepository';
import { SettlementService } from './settlement.service';

describe('SettlementService', () => {
  const DUE = Date.parse('2026-10-01T09:00:00+09:00');
  const summary = (userId: string, tripCount = 10, distanceKm = 50) => ({ userId, tripCount, distanceKm });
  const stored = (token: string) => ({ token, provider: 'EXPO' as const });

  let travelLogs: { summarizeByUser: jest.Mock };
  let rankScores: { findLeaderboard: jest.Mock };
  let tokens: jest.Mocked<IPushTokenRepository>;
  let settings: jest.Mocked<INotificationSettingsRepository>;
  let log: jest.Mocked<ISettlementLogRepository>;
  let sender: { send: jest.Mock };
  let service: SettlementService;

  const sentTo = (): string[] => sender.send.mock.calls.flatMap(([messages]: [PushMessage[]]) => messages.map((m) => m.token));

  beforeEach(() => {
    travelLogs = { summarizeByUser: jest.fn().mockResolvedValue([summary('a'), summary('b')]) };
    rankScores = {
      findLeaderboard: jest.fn().mockResolvedValue([
        { userId: 'a', user: { rankingVisibility: 'PUBLIC' } },
        { userId: 'b', user: { rankingVisibility: 'PUBLIC' } },
      ]),
    };
    tokens = {
      register: jest.fn(),
      remove: jest.fn(),
      findByUserIds: jest.fn().mockResolvedValue(
        new Map([
          ['a', [stored('tok-a1'), stored('tok-a2')]],
          ['b', [stored('tok-b')]],
        ]),
      ),
      deleteTokens: jest.fn().mockResolvedValue(undefined),
    };
    settings = {
      get: jest.fn(),
      update: jest.fn(),
      findMonthlySettlementDisabled: jest.fn().mockResolvedValue(new Set()),
    };
    log = {
      claim: jest.fn().mockImplementation(async (ids: string[]) => ids),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    sender = {
      send: jest.fn().mockImplementation(async (messages: PushMessage[]): Promise<PushResult[]> =>
        messages.map((m) => ({ token: m.token, ok: true, invalidToken: false })),
      ),
    };
    service = new SettlementService(
      travelLogs as unknown as ITravelLogRepository,
      rankScores as unknown as IRankScoreRepository,
      tokens,
      settings,
      log,
      sender as unknown as IPushSender,
    );
  });

  it('does nothing when it is not time yet', async () => {
    const report = await service.runIfDue(Date.parse('2026-10-01T08:59:00+09:00'));

    expect(report.status).toBe('NOT_DUE');
    expect(travelLogs.summarizeByUser).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('asks for the trips of the previous KST month', async () => {
    await service.runIfDue(DUE);

    const [start, end] = travelLogs.summarizeByUser.mock.calls[0];
    expect(start.toISOString()).toBe('2026-08-31T15:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });

  it('sends the settlement to every device of every active user', async () => {
    const report = await service.runIfDue(DUE);

    expect(sentTo().sort()).toEqual(['tok-a1', 'tok-a2', 'tok-b']);
    expect(report).toMatchObject({ status: 'DONE', periodKey: '2026-09', active: 2, attempted: 2, delivered: 2, failed: 0 });
    const [first] = sender.send.mock.calls[0][0];
    expect(first).toMatchObject({
      title: '9월 이동 정산',
      body: '10번 이동해 50.0km를 달렸어요 · 랭킹 1위',
      data: { type: 'MONTHLY_SETTLEMENT', periodKey: '2026-09', screen: 'timeline' },
    });
  });

  it('claims users before sending so a restart cannot send twice', async () => {
    let claimedBeforeSend = false;
    log.claim.mockImplementation(async (ids) => {
      claimedBeforeSend = sender.send.mock.calls.length === 0;
      return ids;
    });

    await service.runIfDue(DUE);

    expect(claimedBeforeSend).toBe(true);
  });

  it('sends nothing the second time because everybody is already claimed', async () => {
    log.claim.mockResolvedValue([]);

    const report = await service.runIfDue(DUE);

    expect(sender.send).not.toHaveBeenCalled();
    expect(report).toMatchObject({ status: 'DONE', active: 2, attempted: 0 });
  });

  it('skips users who turned the setting off and users without a device', async () => {
    settings.findMonthlySettlementDisabled.mockResolvedValue(new Set(['a']));
    travelLogs.summarizeByUser.mockResolvedValue([summary('a'), summary('b'), summary('c')]);

    await service.runIfDue(DUE);

    expect(log.claim).toHaveBeenCalledWith(['b'], '2026-09');
    expect(sentTo()).toEqual(['tok-b']);
  });

  it('does nothing when nobody travelled', async () => {
    travelLogs.summarizeByUser.mockResolvedValue([]);

    const report = await service.runIfDue(DUE);

    expect(report).toMatchObject({ status: 'DONE', active: 0, attempted: 0 });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('leaves the rank out for a traveller who has no score', async () => {
    rankScores.findLeaderboard.mockResolvedValue([{ userId: 'a', user: { rankingVisibility: 'PUBLIC' } }]);

    await service.runIfDue(DUE);

    const messages: PushMessage[] = sender.send.mock.calls[0][0];
    expect(messages.find((m) => m.token === 'tok-b')?.body).toBe('10번 이동해 50.0km를 달렸어요');
    expect(messages.find((m) => m.token === 'tok-a1')?.body).toContain('랭킹 1위');
  });

  it('shows a private user their own place in a ranking that includes them', async () => {
    rankScores.findLeaderboard.mockResolvedValue([
      { userId: 'a', user: { rankingVisibility: 'PUBLIC' } },
      { userId: 'b', user: { rankingVisibility: 'PRIVATE' } },
    ]);

    await service.runIfDue(DUE);

    const messages: PushMessage[] = sender.send.mock.calls[0][0];
    expect(messages.find((m) => m.token === 'tok-b')?.body).toContain('랭킹 2위');
  });

  describe('delivery problems', () => {
    it('counts a user as delivered when at least one device got it', async () => {
      sender.send.mockImplementation(async (messages: PushMessage[]) =>
        messages.map((m) => ({ token: m.token, ok: m.token === 'tok-a2', invalidToken: false })),
      );

      const report = await service.runIfDue(DUE);

      expect(report).toMatchObject({ delivered: 1, failed: 1 });
      expect(log.markFailed).toHaveBeenCalledWith(['b'], '2026-09');
    });

    it('removes tokens the device has unregistered', async () => {
      sender.send.mockImplementation(async (messages: PushMessage[]) =>
        messages.map((m) => ({ token: m.token, ok: m.token !== 'tok-a1', invalidToken: m.token === 'tok-a1' })),
      );

      const report = await service.runIfDue(DUE);

      expect(tokens.deleteTokens).toHaveBeenCalledWith(['tok-a1']);
      expect(report.removedTokens).toBe(1);
      expect(report.delivered).toBe(2);
    });

    it('marks everyone failed when the push service is down, without throwing', async () => {
      sender.send.mockImplementation(async (messages: PushMessage[]) =>
        messages.map((m) => ({ token: m.token, ok: false, invalidToken: false })),
      );

      const report = await service.runIfDue(DUE);

      expect(report).toMatchObject({ delivered: 0, failed: 2 });
      expect(log.markFailed).toHaveBeenCalledWith(['a', 'b'], '2026-09');
      expect(tokens.deleteTokens).toHaveBeenCalledWith([]);
    });
  });
});
