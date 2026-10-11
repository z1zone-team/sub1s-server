import {
  kstMonthKey,
  kstStartOfMonth,
  toKstDate,
} from '../../../common/utils/kst';
import { SETTLEMENT_CHANNEL_ID, PushMessage } from './push';

export const SETTLEMENT_HOUR_KST = 9;
/** 서버가 꺼져 있어 1일 9시를 놓쳐도 이 기간 안에는 따라잡아 보낸다 */
export const SETTLEMENT_CATCH_UP_DAYS = 3;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface SettlementPeriod {
  /** 정산 대상인 지난달 'YYYY-MM' */
  periodKey: string;
  month: number;
  start: Date;
  end: Date;
}

export interface MonthlySummary {
  tripCount: number;
  distanceKm: number;
}

export interface RankInfo {
  rank: number;
  totalUsers: number;
}

/** 이번 달 1일 9시(KST)부터 3일 동안이면 지난달 정산을 보낼 때다. 아니면 null */
export function dueSettlementPeriod(now: number): SettlementPeriod | null {
  const { year, month } = toKstDate(now);
  const startOfMonth = kstStartOfMonth(year, month).getTime();
  const sendFrom = startOfMonth + SETTLEMENT_HOUR_KST * HOUR_MS;
  if (now < sendFrom || now >= startOfMonth + SETTLEMENT_CATCH_UP_DAYS * DAY_MS) {
    return null;
  }

  const previousYear = month === 1 ? year - 1 : year;
  const previousMonth = month === 1 ? 12 : month - 1;
  const start = kstStartOfMonth(previousYear, previousMonth);
  return {
    periodKey: kstMonthKey(start),
    month: previousMonth,
    start,
    end: new Date(startOfMonth),
  };
}

export function buildSettlementMessage(
  token: string,
  period: SettlementPeriod,
  summary: MonthlySummary,
  rank?: RankInfo,
): PushMessage {
  const distance = (Math.round(summary.distanceKm * 10) / 10).toFixed(1);
  const rankText = rank ? ` · 랭킹 ${rank.rank}위` : '';
  return {
    token,
    title: `${period.month}월 이동 정산`,
    body: `${summary.tripCount}번 이동해 ${distance}km를 달렸어요${rankText}`,
    data: {
      type: 'MONTHLY_SETTLEMENT',
      periodKey: period.periodKey,
      screen: 'timeline',
    },
    channelId: SETTLEMENT_CHANNEL_ID,
  };
}

export interface RankedScore {
  userId: string;
  isPrivate: boolean;
}

/**
 * 랭킹 화면과 같은 규칙으로 각자 보는 순위를 구한다. 점수 순으로 정렬된 입력이 필요하다.
 * 비공개 사용자는 남의 순위에서 빠지지만 본인에게는 본인이 들어간 순위가 보인다
 */
export function computeMonthlyRanks(scores: RankedScore[]): Map<string, RankInfo> {
  const publicCount = scores.filter((score) => !score.isPrivate).length;
  const ranks = new Map<string, RankInfo>();

  let publicAhead = 0;
  for (const score of scores) {
    ranks.set(score.userId, {
      rank: publicAhead + 1,
      totalUsers: score.isPrivate ? publicCount + 1 : publicCount,
    });
    if (!score.isPrivate) publicAhead += 1;
  }
  return ranks;
}
