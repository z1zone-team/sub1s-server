import {
  BASE_PERSONAL_WEIGHTS,
  contextOf,
  MIN_CONTEXT_HISTORY,
  MIN_OVERALL_HISTORY,
  personalize,
  WEIGHT_LIMITS,
} from './route-personalizer';

// KST 시각을 만든다. 2026-10-12는 월요일, 10-17은 토요일, 10-18은 일요일
const kst = (day: number, hhmm: string): Date =>
  new Date(`2026-10-${String(day).padStart(2, '0')}T${hhmm}:00+09:00`);

const MON = 12;
const SAT = 17;
const SUN = 18;
// 낮 공강 시간: 혼잡 가중이 붙지 않는 기준 시각
const MIDDAY = kst(MON, '13:00');

const history = (
  mode: 'OPTIMAL' | 'COMFORTABLE' | 'PERSONAL' | 'CHEAPEST',
  at: Date,
  count: number,
) => Array.from({ length: count }, () => ({ mode, createdAt: at }));

const base = {
  routePrefs: [] as string[],
  purposes: [] as string[],
  history: [] as ReturnType<typeof history>,
  departureAt: MIDDAY,
};

describe('contextOf', () => {
  it.each([
    ['평일 아침 6시는 새벽', kst(MON, '06:00'), 'EARLY_MORNING'],
    ['평일 6시 30분부터 등교, 출근', kst(MON, '06:30'), 'WEEKDAY_MORNING_RUSH'],
    ['평일 9시 59분은 아직 등교, 출근', kst(MON, '09:59'), 'WEEKDAY_MORNING_RUSH'],
    ['평일 10시부터 낮 공강', kst(MON, '10:00'), 'WEEKDAY_MIDDAY'],
    ['평일 16시 29분은 낮', kst(MON, '16:29'), 'WEEKDAY_MIDDAY'],
    ['평일 16시 30분부터 하교, 퇴근', kst(MON, '16:30'), 'WEEKDAY_EVENING_RUSH'],
    ['평일 20시 30분부터 저녁', kst(MON, '20:30'), 'WEEKDAY_NIGHT'],
    ['22시부터 심야', kst(MON, '22:00'), 'LATE_NIGHT'],
    ['자정은 심야', kst(MON, '00:00'), 'LATE_NIGHT'],
    ['새벽 4시 59분은 심야', kst(MON, '04:59'), 'LATE_NIGHT'],
    ['새벽 5시부터 새벽', kst(MON, '05:00'), 'EARLY_MORNING'],
    ['토요일 낮', kst(SAT, '14:00'), 'WEEKEND_DAYTIME'],
    ['일요일 9시는 주말 그 외', kst(SUN, '09:00'), 'WEEKEND_OTHER'],
    ['일요일 20시는 주말 그 외', kst(SUN, '20:00'), 'WEEKEND_OTHER'],
    ['주말 심야는 심야', kst(SAT, '23:30'), 'LATE_NIGHT'],
  ])('%s', (_name, date, expected) => {
    expect(contextOf(date)).toBe(expected);
  });

  it('서버 시간대가 아니라 한국 시간으로 계산한다', () => {
    // UTC 일요일 15:30은 한국 월요일 00:30(심야)이다
    expect(contextOf(new Date('2026-10-11T15:30:00Z'))).toBe('LATE_NIGHT');
    // UTC 월요일 21:00은 한국 화요일 06:00(새벽)이다
    expect(contextOf(new Date('2026-10-12T21:00:00Z'))).toBe('EARLY_MORNING');
  });
});

describe('personalize', () => {
  it('신호가 없으면 기존 고정 가중치가 그대로 나온다', () => {
    const result = personalize(base);

    expect(result.weights).toEqual(BASE_PERSONAL_WEIGHTS);
    expect(result.reasons).toEqual([]);
    expect(result.usedHistory).toBe(false);
    expect(result.fareSensitive).toBe(false);
    expect(result.context).toBe('WEEKDAY_MIDDAY');
  });

  describe('설문의 경로 취향', () => {
    it('빠르게는 혼잡과 환승 가중을 줄인다', () => {
      const result = personalize({ ...base, routePrefs: ['FAST'] });

      expect(result.weights).toEqual({ congestion: 0.75, transferSec: 144 });
      expect(result.reasons).toEqual(['PREF_FAST']);
    });

    it('환승 적게는 환승 비용을 180초 늘린다', () => {
      const result = personalize({ ...base, routePrefs: ['FEW_TRANSFERS'] });

      expect(result.weights).toEqual({ congestion: 1.5, transferSec: 420 });
    });

    it('덜 붐비게는 혼잡 가중을 1 늘린다', () => {
      const result = personalize({ ...base, routePrefs: ['UNCROWDED'] });

      expect(result.weights).toEqual({ congestion: 2.5, transferSec: 240 });
    });

    it('약냉방칸은 혼잡 가중을 0.5 늘린다', () => {
      const result = personalize({ ...base, routePrefs: ['WEAK_AC'] });

      expect(result.weights.congestion).toBe(2);
    });

    it('덜 걷게는 환승 비용을 120초 늘린다', () => {
      const result = personalize({ ...base, routePrefs: ['LESS_WALK'] });

      expect(result.weights.transferSec).toBe(360);
    });

    it('엔진이 다루지 못하는 취향(앉아서, 엘리베이터)은 가중치에 쓰지 않는다', () => {
      const result = personalize({ ...base, routePrefs: ['SEAT', 'ELEVATOR'] });

      expect(result.weights).toEqual(BASE_PERSONAL_WEIGHTS);
      expect(result.reasons).toEqual([]);
    });

    it('여러 취향이 함께 적용된다', () => {
      const result = personalize({
        ...base,
        routePrefs: ['FEW_TRANSFERS', 'UNCROWDED'],
      });

      expect(result.weights).toEqual({ congestion: 2.5, transferSec: 420 });
      expect(result.reasons).toEqual(['PREF_FEW_TRANSFERS', 'PREF_UNCROWDED']);
    });
  });

  describe('이동 목적', () => {
    it('통학은 등교 시간대에 혼잡과 환승을 더 피한다', () => {
      const result = personalize({
        ...base,
        purposes: ['SCHOOL'],
        departureAt: kst(MON, '08:30'),
      });

      // 목적 +0.5, +60 그리고 혼잡 시간대 +0.5, +60
      expect(result.weights).toEqual({ congestion: 2.5, transferSec: 360 });
      expect(result.reasons).toEqual(['PURPOSE_SCHOOL', 'CONTEXT_RUSH']);
    });

    it('출퇴근은 퇴근 시간대에 혼잡과 환승을 더 피한다', () => {
      const result = personalize({
        ...base,
        purposes: ['COMMUTE'],
        departureAt: kst(MON, '18:00'),
      });

      expect(result.reasons).toEqual(['PURPOSE_COMMUTE', 'CONTEXT_RUSH']);
    });

    it('통학이어도 낮 공강 시간대에는 목적 가중이 붙지 않는다', () => {
      const result = personalize({ ...base, purposes: ['SCHOOL'] });

      expect(result.weights).toEqual(BASE_PERSONAL_WEIGHTS);
      expect(result.reasons).toEqual([]);
    });

    it('병원은 시간대와 상관없이 혼잡과 환승을 더 피한다', () => {
      const result = personalize({ ...base, purposes: ['HOSPITAL'] });

      expect(result.weights).toEqual({ congestion: 2, transferSec: 300 });
      expect(result.reasons).toEqual(['PURPOSE_HOSPITAL']);
    });

    it('여행과 쇼핑은 주말 낮이나 평일 낮에 환승을 더 피한다', () => {
      const weekend = personalize({
        ...base,
        purposes: ['SHOPPING'],
        departureAt: kst(SAT, '14:00'),
      });
      const rush = personalize({
        ...base,
        purposes: ['TRAVEL'],
        departureAt: kst(MON, '08:00'),
      });

      expect(weekend.weights.transferSec).toBe(300);
      expect(weekend.reasons).toEqual(['PURPOSE_LEISURE']);
      expect(rush.reasons).not.toContain('PURPOSE_LEISURE');
    });
  });

  describe('출발 시각의 상황', () => {
    it('혼잡한 시간대는 혼잡과 환승을 더 피한다', () => {
      const result = personalize({ ...base, departureAt: kst(MON, '08:00') });

      expect(result.weights).toEqual({ congestion: 2, transferSec: 300 });
      expect(result.reasons).toEqual(['CONTEXT_RUSH']);
    });

    it('심야와 새벽은 한산해서 혼잡 가중을 줄이고 환승을 덜 피한다', () => {
      const late = personalize({ ...base, departureAt: kst(MON, '23:30') });
      const early = personalize({ ...base, departureAt: kst(MON, '05:30') });

      expect(late.weights).toEqual({ congestion: 0.75, transferSec: 180 });
      expect(early.weights).toEqual({ congestion: 0.75, transferSec: 180 });
      expect(late.reasons).toEqual(['CONTEXT_NIGHT']);
    });

    it('주말 낮과 평일 저녁은 시간대 가중이 없다', () => {
      expect(personalize({ ...base, departureAt: kst(SAT, '14:00') }).weights).toEqual(
        BASE_PERSONAL_WEIGHTS,
      );
      expect(personalize({ ...base, departureAt: kst(MON, '21:00') }).weights).toEqual(
        BASE_PERSONAL_WEIGHTS,
      );
    });
  });

  describe('이전에 고른 모드', () => {
    const rushAt = kst(MON, '08:00');

    it('같은 시간대에 여유를 자주 골랐으면 혼잡을 더 피한다', () => {
      const result = personalize({
        ...base,
        departureAt: rushAt,
        history: history('COMFORTABLE', kst(MON - 7, '08:10'), 3),
      });

      expect(result.usedHistory).toBe(true);
      expect(result.reasons).toContain('HISTORY_COMFORT');
      // 혼잡 시간대 +0.5, 이력 +0.5
      expect(result.weights.congestion).toBe(2.5);
    });

    it('같은 시간대에 최적을 자주 골랐으면 혼잡과 환승을 덜 피한다', () => {
      const result = personalize({
        ...base,
        departureAt: rushAt,
        history: history('OPTIMAL', kst(MON - 7, '08:10'), MIN_CONTEXT_HISTORY),
      });

      expect(result.reasons).toContain('HISTORY_FAST');
      // 혼잡 시간대(+0.5, +60) 뒤 이력(-0.5, -60)
      expect(result.weights).toEqual(BASE_PERSONAL_WEIGHTS);
    });

    it('같은 시간대 이력이 모자라면 전체 이력이 충분할 때 전체를 쓴다', () => {
      const result = personalize({
        ...base,
        history: history('COMFORTABLE', kst(SAT, '14:00'), MIN_OVERALL_HISTORY),
      });

      expect(result.usedHistory).toBe(false);
      expect(result.reasons).toEqual(['HISTORY_COMFORT']);
    });

    it('이력이 모자라면 쓰지 않는다', () => {
      const result = personalize({
        ...base,
        history: history('COMFORTABLE', kst(SAT, '14:00'), MIN_OVERALL_HISTORY - 1),
      });

      expect(result.reasons).toEqual([]);
      expect(result.weights).toEqual(BASE_PERSONAL_WEIGHTS);
    });

    it('최소 비용을 40% 이상 골랐으면 요금 민감으로 표시하고 그것만으로 가중치를 바꾸지 않는다', () => {
      const result = personalize({
        ...base,
        history: [
          ...history('CHEAPEST', kst(MON, '13:00'), 2),
          ...history('PERSONAL', kst(MON, '13:30'), 3),
        ],
      });

      expect(result.fareSensitive).toBe(true);
      expect(result.reasons).toEqual(['HISTORY_CHEAP']);
      expect(result.weights).toEqual(BASE_PERSONAL_WEIGHTS);
    });

    it('최소 비용을 40% 미만으로 골랐으면 요금 민감이 아니다', () => {
      const result = personalize({
        ...base,
        history: [
          ...history('CHEAPEST', kst(MON, '13:00'), 1),
          ...history('PERSONAL', kst(MON, '13:30'), 4),
        ],
      });

      expect(result.fareSensitive).toBe(false);
    });
  });

  it('값은 허용 범위 안으로 맞춘다', () => {
    const high = personalize({
      ...base,
      routePrefs: ['UNCROWDED', 'WEAK_AC', 'FEW_TRANSFERS', 'LESS_WALK'],
      purposes: ['COMMUTE', 'HOSPITAL'],
      departureAt: kst(MON, '08:00'),
      history: history('COMFORTABLE', kst(MON - 7, '08:10'), 5),
    });
    const low = personalize({
      ...base,
      routePrefs: ['FAST'],
      departureAt: kst(MON, '23:30'),
      history: history('OPTIMAL', kst(MON - 7, '23:40'), 5),
    });

    expect(high.weights.congestion).toBe(WEIGHT_LIMITS.congestion.max);
    expect(high.weights.transferSec).toBe(WEIGHT_LIMITS.transferSec.max);
    expect(low.weights.congestion).toBe(WEIGHT_LIMITS.congestion.min);
    expect(low.weights.transferSec).toBe(WEIGHT_LIMITS.transferSec.min);
  });
});
