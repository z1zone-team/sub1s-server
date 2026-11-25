export const TRAVEL_PURPOSES = [
  'COMMUTE',
  'SCHOOL',
  'MEETING',
  'TRAVEL',
  'EXERCISE',
  'SHOPPING',
  'HOSPITAL',
  'DATE',
] as const;

export const ROUTE_PREFS = [
  'FAST',
  'FEW_TRANSFERS',
  'WEAK_AC',
  'UNCROWDED',
  'LESS_WALK',
  'SEAT',
  'ELEVATOR',
  'LOW_FARE',
  'AVOID_STAIRS',
  'EXPRESS',
  'FAMILIAR_ROUTE',
] as const;

export type TravelPurpose = (typeof TRAVEL_PURPOSES)[number];
export type RoutePref = (typeof ROUTE_PREFS)[number];

export interface UserPreferences {
  purposes: TravelPurpose[];
  routePrefs: RoutePref[];
}

export function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * 점수 계산에 쓰는 취향. 좌석 데이터가 없어 앉아서 가기(SEAT)는 덜 붐비는 경로(UNCROWDED)로 근사한다
 */
export function scoringRoutePrefs(routePrefs: readonly string[]): string[] {
  return routePrefs.includes('SEAT') && !routePrefs.includes('UNCROWDED')
    ? [...routePrefs, 'UNCROWDED']
    : [...routePrefs];
}
