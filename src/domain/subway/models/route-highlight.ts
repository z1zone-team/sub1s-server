export const ROUTE_HIGHLIGHTS = [
  'FASTEST',
  'FEWEST_TRANSFERS',
  'NO_TRANSFER',
  'LEAST_CROWDED',
  'LEAST_WALK',
  'CHEAPEST',
  'WEAK_AC_CAR',
] as const;

export type RouteHighlight = (typeof ROUTE_HIGHLIGHTS)[number];

export interface HighlightInput {
  totalDurationSec: number;
  transferCount: number;
  totalFare: number;
  /** 지하철 구간의 소요시간 가중 평균 혼잡도(0~100). 지하철 구간이 없으면 null */
  averageCongestionRate: number | null;
  /** 출발·도착 도보와 환승 도보를 합친 초 */
  walkSec: number;
  hasWeakAcCar: boolean;
}

/** 다른 옵션보다 이만큼 이상 나을 때만 비교 태그를 붙인다. 사소한 차이를 장점으로 내세우지 않기 위함 */
export const HIGHLIGHT_MARGINS = {
  durationSec: 60,
  transferCount: 1,
  fare: 1,
  congestionRate: 5,
  walkSec: 60,
} as const;

function winners(
  inputs: HighlightInput[],
  pick: (input: HighlightInput) => number | null,
  margin: number,
): Set<number> {
  const values = inputs.map(pick);
  const known = values.filter((value): value is number => value !== null);
  if (known.length < 2) return new Set();

  const best = Math.min(...known);
  const worst = Math.max(...known);
  if (worst - best < margin) return new Set();

  const result = new Set<number>();
  values.forEach((value, index) => {
    if (value !== null && value === best) result.add(index);
  });
  return result;
}

/** 입력 순서와 같은 순서로 옵션별 태그를 돌려준다. 옵션이 하나뿐이면 비교 태그는 없다 */
export function computeRouteHighlights(inputs: HighlightInput[]): RouteHighlight[][] {
  const comparative: [RouteHighlight, Set<number>][] = [
    ['FASTEST', winners(inputs, (i) => i.totalDurationSec, HIGHLIGHT_MARGINS.durationSec)],
    ['FEWEST_TRANSFERS', winners(inputs, (i) => i.transferCount, HIGHLIGHT_MARGINS.transferCount)],
    ['LEAST_CROWDED', winners(inputs, (i) => i.averageCongestionRate, HIGHLIGHT_MARGINS.congestionRate)],
    ['LEAST_WALK', winners(inputs, (i) => i.walkSec, HIGHLIGHT_MARGINS.walkSec)],
    ['CHEAPEST', winners(inputs, (i) => i.totalFare, HIGHLIGHT_MARGINS.fare)],
  ];

  return inputs.map((input, index) => {
    const tags = new Set<RouteHighlight>();
    for (const [tag, indexes] of comparative) {
      if (indexes.has(index)) tags.add(tag);
    }
    if (input.transferCount === 0) tags.add('NO_TRANSFER');
    if (input.hasWeakAcCar) tags.add('WEAK_AC_CAR');
    return ROUTE_HIGHLIGHTS.filter((tag) => tags.has(tag));
  });
}
