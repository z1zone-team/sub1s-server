import { createHash } from 'node:crypto';
import {
  ChoiceFeatures,
  PreferenceModel,
  importance,
} from './preference-model';
export interface ComparableOption {
  familiarity?: number;
  /** 승하차·환승 역 중 엘리베이터 인접 문 자료가 있는 역의 비율(0~1). 자료가 없으면 undefined */
  elevatorAccess?: number;
  mode: string;
  stationIds?: string[];
  totalDurationSec: number;
  totalFare: number;
  transferCount: number;
  totalWalkDistanceKm?: number;
  segments: Array<{
    lineId: string;
    durationSec: number;
    isExpress: boolean;
    cars?: Array<{ isWeakAirConditioned: boolean }>;
    congestionRate: number;
    congestionSource?: string;
  }>;
}
export function routeFeatures(option: ComparableOption): ChoiceFeatures {
  const rides = option.segments.filter((segment) => segment.lineId !== 'WALK');
  const time = rides.reduce((sum, segment) => sum + segment.durationSec, 0);
  const statistical =
    rides.length > 0 &&
    rides.every((segment) => segment.congestionSource === 'STATISTICS');
  return {
    time: option.totalDurationSec,
    transfer: option.transferCount,
    fare: option.totalFare,
    ...(option.totalWalkDistanceKm !== undefined
      ? { walk: option.totalWalkDistanceKm * 1000 }
      : {}),
    ...(option.familiarity !== undefined
      ? { familiarRoute: option.familiarity }
      : {}),
    ...(option.elevatorAccess !== undefined
      ? { elevator: option.elevatorAccess }
      : {}),
    ...(rides.length && rides.every((segment) => segment.cars?.length)
      ? {
          weakAc:
            rides.filter((segment) =>
              segment.cars!.some((car) => car.isWeakAirConditioned),
            ).length / rides.length,
        }
      : {}),
    ...(statistical
      ? {
          crowd: time
            ? rides.reduce(
                (sum, segment) =>
                  sum + segment.congestionRate * segment.durationSec,
                0,
              ) / time
            : 0,
        }
      : {}),
    express: time
      ? rides.reduce(
          (sum, segment) => sum + (segment.isExpress ? segment.durationSec : 0),
          0,
        ) / time
      : 0,
  };
}
const FACTORS = [
  'time',
  'fare',
  'transfer',
  'crowd',
  'walk',
  'express',
  'familiarRoute',
  'weakAc',
  'elevator',
] as const;
/** 값이 클수록 좋은 축. 0.5를 넘는 선호만 가중치로 쓴다 */
const HIGHER_IS_BETTER = new Set<string>([
  'express',
  'familiarRoute',
  'weakAc',
  'elevator',
]);
const BASE = {
  time: 1,
  fare: 0.3,
  transfer: 0.4,
  crowd: 0.4,
  walk: 0.2,
  express: 0,
  familiarRoute: 0,
  weakAc: 0,
  elevator: 0,
};
const SPANS = {
  time: 180,
  fare: 200,
  transfer: 1,
  crowd: 10,
  walk: 216,
  express: 1,
  familiarRoute: 1,
  weakAc: 1,
  elevator: 1,
};
/** Shared candidates, separate public and personal importance. Unsupported data never means a good zero cost. */
export function chooseRecommendation<T extends ComparableOption>(
  options: T[],
  preference?: PreferenceModel,
): T | undefined {
  if (!options.length) return undefined;
  const raw = options.map(routeFeatures);
  const supported = FACTORS.filter((axis) =>
    raw.every((features) => features[axis] !== undefined),
  );
  const weights = supported.map((axis) =>
    preference
      ? HIGHER_IS_BETTER.has(axis)
        ? Math.max(0, importance(preference, axis) - 0.5)
        : BASE[axis] * 2 * importance(preference, axis)
      : BASE[axis],
  );
  const values = supported.map((axis) => {
    const xs = raw.map((features) =>
      HIGHER_IS_BETTER.has(axis) ? 1 - features[axis]! : features[axis]!,
    );
    const min = Math.min(...xs);
    const scale = Math.max(Math.max(...xs) - min, SPANS[axis]);
    return xs.map((x) => (x - min) / scale);
  });
  const score = (index: number): number =>
    values.reduce((sum, xs, axis) => sum + xs[index] * weights[axis], 0);
  let best = 0;
  for (let i = 1; i < options.length; i++) {
    const delta = score(i) - score(best);
    if (
      delta < -1e-9 ||
      (Math.abs(delta) <= 1e-9 &&
        (options[i].totalDurationSec < options[best].totalDurationSec ||
          (options[i].totalDurationSec === options[best].totalDurationSec &&
            (options[i].stationIds ?? []).join('|') <
              (options[best].stationIds ?? []).join('|'))))
    )
      best = i;
  }
  return options[best];
}

export function routeFingerprint(option: ComparableOption): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        stations: option.stationIds ?? [],
        lines: option.segments.map((segment) => [
          segment.lineId,
          segment.isExpress,
        ]),
      }),
    )
    .digest('hex');
}
