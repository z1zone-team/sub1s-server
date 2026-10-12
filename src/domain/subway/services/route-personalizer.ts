import type { RouteMode, RouteWeights } from '../models/route';

/** 출발 시각의 상황. 대학생(등교, 공강, 하교)과 직장인(출퇴근)을 함께 담는다 */
export type RouteContext =
  | 'WEEKDAY_MORNING_RUSH' // 평일 06:30~10:00 등교, 출근
  | 'WEEKDAY_MIDDAY' // 평일 10:00~16:30 공강, 낮 이동
  | 'WEEKDAY_EVENING_RUSH' // 평일 16:30~20:30 하교, 퇴근
  | 'WEEKDAY_NIGHT' // 평일 20:30~22:00 저녁 이동, 학원, 약속
  | 'LATE_NIGHT' // 22:00~05:00 심야
  | 'EARLY_MORNING' // 05:00~06:30 새벽
  | 'WEEKEND_DAYTIME' // 주말 10:00~20:00
  | 'WEEKEND_OTHER'; // 주말 그 외

/** 서버가 가중치를 만든 근거. 앱이 추천 이유 문구를 만드는 재료다 */
export type PersonalizationReason =
  | 'PREF_FAST'
  | 'PREF_FEW_TRANSFERS'
  | 'PREF_UNCROWDED'
  | 'PREF_WEAK_AC'
  | 'PREF_LESS_WALK'
  | 'PURPOSE_COMMUTE'
  | 'PURPOSE_SCHOOL'
  | 'PURPOSE_HOSPITAL'
  | 'PURPOSE_LEISURE'
  | 'CONTEXT_RUSH'
  | 'CONTEXT_NIGHT'
  | 'HISTORY_COMFORT'
  | 'HISTORY_FAST'
  | 'HISTORY_CHEAP';

export interface PersonalizationInput {
  routePrefs: readonly string[];
  purposes: readonly string[];
  /** 최근 이동에서 고른 모드. 시각은 이동을 마친 시각(UTC 기준 Date) */
  history: ReadonlyArray<{ mode: RouteMode; createdAt: Date }>;
  departureAt: Date;
}

export interface Personalization {
  weights: RouteWeights;
  context: RouteContext;
  reasons: PersonalizationReason[];
  /** 같은 시간대의 선택 이력이 쓰였는가(아니면 전체 이력 또는 이력 없음) */
  usedHistory: boolean;
  /** 최소 비용을 자주 골랐는가. 엔진이 요금을 가중치로 다루지 못해 앱이 후보를 고를 때 쓴다 */
  fareSensitive: boolean;
}

/** 기존 고정 추천(PERSONAL)의 가중치. 개인화 신호가 없으면 이 값이 그대로 나온다 */
export const BASE_PERSONAL_WEIGHTS: RouteWeights = {
  congestion: 1.5,
  transferSec: 240,
};

export const WEIGHT_LIMITS = {
  congestion: { min: 0, max: 4 },
  transferSec: { min: 60, max: 600 },
} as const;

/** 같은 시간대의 선택 이력이 이 건수 이상이어야 시간대 이력으로 본다 */
export const MIN_CONTEXT_HISTORY = 3;
/** 시간대 이력이 모자랄 때 전체 이력은 이 건수 이상이어야 쓴다 */
export const MIN_OVERALL_HISTORY = 5;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** 한국 시간 기준으로 요일(0 일요일)과 하루 중 분(0~1439)을 구한다. 서버 시간대와 상관없다 */
export function kstDayAndMinute(date: Date): { day: number; minute: number } {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    day: kst.getUTCDay(),
    minute: kst.getUTCHours() * 60 + kst.getUTCMinutes(),
  };
}

export function contextOf(date: Date): RouteContext {
  const { day, minute } = kstDayAndMinute(date);
  const weekend = day === 0 || day === 6;
  if (minute >= 22 * 60 || minute < 5 * 60) return 'LATE_NIGHT';
  if (minute < 6 * 60 + 30) return 'EARLY_MORNING';
  if (weekend) {
    return minute >= 10 * 60 && minute < 20 * 60
      ? 'WEEKEND_DAYTIME'
      : 'WEEKEND_OTHER';
  }
  if (minute < 10 * 60) return 'WEEKDAY_MORNING_RUSH';
  if (minute < 16 * 60 + 30) return 'WEEKDAY_MIDDAY';
  if (minute < 20 * 60 + 30) return 'WEEKDAY_EVENING_RUSH';
  return 'WEEKDAY_NIGHT';
}

/** 혼잡한 시간대: 등교, 출근과 하교, 퇴근 */
const isRush = (context: RouteContext): boolean =>
  context === 'WEEKDAY_MORNING_RUSH' || context === 'WEEKDAY_EVENING_RUSH';

const isNight = (context: RouteContext): boolean =>
  context === 'LATE_NIGHT' || context === 'EARLY_MORNING';

interface HistoryShare {
  comfortable: number;
  optimal: number;
  cheapest: number;
}

function shares(
  records: ReadonlyArray<{ mode: RouteMode }>,
): HistoryShare | undefined {
  if (records.length === 0) return undefined;
  const count = (mode: RouteMode): number =>
    records.filter((record) => record.mode === mode).length / records.length;
  return {
    comfortable: count('COMFORTABLE'),
    optimal: count('OPTIMAL'),
    cheapest: count('CHEAPEST'),
  };
}

/**
 * 사용자의 설문, 이동 목적, 출발 시각의 상황, 이전에 고른 모드로 추천(PERSONAL) 경로의 가중치를 만든다.
 * 신호가 없으면 기존 고정 가중치가 그대로 나온다. 값은 허용 범위 안으로 맞춘다
 */
export function personalize(input: PersonalizationInput): Personalization {
  const context = contextOf(input.departureAt);
  const reasons: PersonalizationReason[] = [];
  let congestion: number = BASE_PERSONAL_WEIGHTS.congestion;
  let transferSec: number = BASE_PERSONAL_WEIGHTS.transferSec;
  const prefs = new Set(input.routePrefs);
  const purposes = new Set(input.purposes);

  // 1. 설문의 경로 취향
  if (prefs.has('FAST')) {
    congestion *= 0.5;
    transferSec *= 0.6;
    reasons.push('PREF_FAST');
  }
  if (prefs.has('FEW_TRANSFERS')) {
    transferSec += 180;
    reasons.push('PREF_FEW_TRANSFERS');
  }
  if (prefs.has('UNCROWDED')) {
    congestion += 1;
    reasons.push('PREF_UNCROWDED');
  }
  if (prefs.has('WEAK_AC')) {
    congestion += 0.5;
    reasons.push('PREF_WEAK_AC');
  }
  if (prefs.has('LESS_WALK')) {
    transferSec += 120;
    reasons.push('PREF_LESS_WALK');
  }

  // 2. 이동 목적. 통학과 출퇴근은 정해진 시간에 도착해야 하고 혼잡 시간대와 겹치는 일이 많다
  const rushPurpose = purposes.has('COMMUTE') || purposes.has('SCHOOL');
  if (rushPurpose && isRush(context)) {
    congestion += 0.5;
    transferSec += 60;
    reasons.push(purposes.has('SCHOOL') ? 'PURPOSE_SCHOOL' : 'PURPOSE_COMMUTE');
  }
  if (purposes.has('HOSPITAL')) {
    // 몸이 불편할 수 있어 환승과 혼잡을 더 피한다
    congestion += 0.5;
    transferSec += 60;
    reasons.push('PURPOSE_HOSPITAL');
  }
  if (
    (purposes.has('TRAVEL') || purposes.has('SHOPPING')) &&
    (context === 'WEEKEND_DAYTIME' || context === 'WEEKDAY_MIDDAY')
  ) {
    // 짐이 있을 수 있어 환승을 더 피한다
    transferSec += 60;
    reasons.push('PURPOSE_LEISURE');
  }

  // 3. 출발 시각의 상황
  if (isRush(context)) {
    congestion += 0.5;
    transferSec += 60;
    reasons.push('CONTEXT_RUSH');
  } else if (isNight(context)) {
    congestion *= 0.5;
    transferSec -= 60;
    reasons.push('CONTEXT_NIGHT');
  }

  // 4. 이전에 고른 모드: 같은 시간대의 이력이 충분하면 그것을, 아니면 전체 이력이 충분할 때 전체를 쓴다
  const sameContext = input.history.filter(
    (record) => contextOf(record.createdAt) === context,
  );
  let usedHistory = false;
  let historyShares: HistoryShare | undefined;
  if (sameContext.length >= MIN_CONTEXT_HISTORY) {
    historyShares = shares(sameContext);
    usedHistory = true;
  } else if (input.history.length >= MIN_OVERALL_HISTORY) {
    historyShares = shares(input.history);
  }
  let fareSensitive = false;
  if (historyShares) {
    if (historyShares.comfortable >= 0.5) {
      congestion += 0.5;
      reasons.push('HISTORY_COMFORT');
    } else if (historyShares.optimal >= 0.5) {
      congestion -= 0.5;
      transferSec -= 60;
      reasons.push('HISTORY_FAST');
    }
    if (historyShares.cheapest >= 0.4) {
      fareSensitive = true;
      reasons.push('HISTORY_CHEAP');
    }
  }

  return {
    weights: {
      congestion: clamp(
        congestion,
        WEIGHT_LIMITS.congestion.min,
        WEIGHT_LIMITS.congestion.max,
      ),
      transferSec: clamp(
        transferSec,
        WEIGHT_LIMITS.transferSec.min,
        WEIGHT_LIMITS.transferSec.max,
      ),
    },
    context,
    reasons,
    usedHistory,
    fareSensitive,
  };
}
