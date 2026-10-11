import {
  buildSettlementMessage,
  computeMonthlyRanks,
  dueSettlementPeriod,
} from './monthly-settlement';
import { isValidPushToken } from './push';

describe('dueSettlementPeriod', () => {
  const at = (iso: string) => Date.parse(`${iso}+09:00`);

  it('is not due before 9 AM KST on the 1st', () => {
    expect(dueSettlementPeriod(at('2026-10-01T08:59:59'))).toBeNull();
    expect(dueSettlementPeriod(at('2026-10-01T00:00:00'))).toBeNull();
  });

  it('is due from 9 AM KST on the 1st and settles the previous month', () => {
    const period = dueSettlementPeriod(at('2026-10-01T09:00:00'));

    expect(period).toMatchObject({ periodKey: '2026-09', month: 9 });
    expect(period?.start.toISOString()).toBe('2026-08-31T15:00:00.000Z');
    expect(period?.end.toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });

  it('keeps catching up for three days and then stops', () => {
    expect(dueSettlementPeriod(at('2026-10-02T12:00:00'))?.periodKey).toBe('2026-09');
    expect(dueSettlementPeriod(at('2026-10-03T23:59:59'))?.periodKey).toBe('2026-09');
    expect(dueSettlementPeriod(at('2026-10-04T00:00:00'))).toBeNull();
    expect(dueSettlementPeriod(at('2026-10-15T12:00:00'))).toBeNull();
  });

  it('settles December in January across the year boundary', () => {
    const period = dueSettlementPeriod(at('2027-01-01T09:00:00'));

    expect(period).toMatchObject({ periodKey: '2026-12', month: 12 });
    expect(period?.start.toISOString()).toBe('2026-11-30T15:00:00.000Z');
    expect(period?.end.toISOString()).toBe('2026-12-31T15:00:00.000Z');
  });

  it('uses the KST date, not the UTC date', () => {
    // 2026-09-30 23:30 UTC는 KST로 10월 1일 08:30이라 아직 이르다
    expect(dueSettlementPeriod(Date.parse('2026-09-30T23:30:00Z'))).toBeNull();
    // 2026-10-01 00:00 UTC는 KST로 10월 1일 09:00이다
    expect(dueSettlementPeriod(Date.parse('2026-10-01T00:00:00Z'))?.periodKey).toBe('2026-09');
  });
});

describe('buildSettlementMessage', () => {
  const period = dueSettlementPeriod(Date.parse('2026-10-01T00:00:00Z'))!;

  it('writes the trips, the distance and the rank', () => {
    const message = buildSettlementMessage(
      'ExponentPushToken[abc]',
      period,
      { tripCount: 45, distanceKm: 128.4321 },
      { rank: 12, totalUsers: 2481 },
    );

    expect(message).toEqual({
      token: 'ExponentPushToken[abc]',
      title: '9월 이동 정산',
      body: '45번 이동해 128.4km를 달렸어요 · 랭킹 12위',
      data: { type: 'MONTHLY_SETTLEMENT', periodKey: '2026-09', screen: 'timeline' },
      channelId: 'subway-settlement',
    });
  });

  it('leaves the rank out when the user has none', () => {
    const message = buildSettlementMessage('t', period, { tripCount: 1, distanceKm: 3 });

    expect(message.body).toBe('1번 이동해 3.0km를 달렸어요');
  });
});

describe('computeMonthlyRanks', () => {
  it('ranks public users by their position', () => {
    const ranks = computeMonthlyRanks([
      { userId: 'a', isPrivate: false },
      { userId: 'b', isPrivate: false },
      { userId: 'c', isPrivate: false },
    ]);

    expect(ranks.get('a')).toEqual({ rank: 1, totalUsers: 3 });
    expect(ranks.get('c')).toEqual({ rank: 3, totalUsers: 3 });
  });

  it('removes private users from other people ranks but keeps them in their own', () => {
    const ranks = computeMonthlyRanks([
      { userId: 'a', isPrivate: false },
      { userId: 'p', isPrivate: true },
      { userId: 'b', isPrivate: false },
    ]);

    expect(ranks.get('a')).toEqual({ rank: 1, totalUsers: 2 });
    expect(ranks.get('b')).toEqual({ rank: 2, totalUsers: 2 });
    expect(ranks.get('p')).toEqual({ rank: 2, totalUsers: 3 });
  });

  it('gives a private user at the top the first place', () => {
    const ranks = computeMonthlyRanks([
      { userId: 'p', isPrivate: true },
      { userId: 'a', isPrivate: false },
    ]);

    expect(ranks.get('p')).toEqual({ rank: 1, totalUsers: 2 });
    expect(ranks.get('a')).toEqual({ rank: 1, totalUsers: 1 });
  });

  it('returns nothing for no scores', () => {
    expect(computeMonthlyRanks([]).size).toBe(0);
  });
});

describe('isValidPushToken', () => {
  it('accepts Expo push tokens in both spellings', () => {
    expect(isValidPushToken('EXPO', 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
    expect(isValidPushToken('EXPO', 'ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
  });

  it('rejects other shapes, an empty id, whitespace and over-long tokens', () => {
    expect(isValidPushToken('EXPO', 'fcm-token-without-wrapper')).toBe(false);
    expect(isValidPushToken('EXPO', 'ExponentPushToken[]')).toBe(false);
    expect(isValidPushToken('EXPO', 'ExponentPushToken[a b]')).toBe(false);
    expect(isValidPushToken('EXPO', `ExponentPushToken[${'x'.repeat(300)}]`)).toBe(false);
  });

  it('does not accept token kinds the server cannot send yet', () => {
    expect(isValidPushToken('FCM', 'ExponentPushToken[abc]')).toBe(false);
    expect(isValidPushToken('APNS', 'abc')).toBe(false);
  });
});
