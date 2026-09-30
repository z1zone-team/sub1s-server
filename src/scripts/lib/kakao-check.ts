import { distanceKm, normalize } from './subway-common';

export interface KakaoPlace {
  place_name: string;
  category_group_code: string;
  x: string;
  y: string;
}

export interface StationToCheck {
  id: string;
  stationName: string;
  lat: number;
  lng: number;
}

export type CheckStatus = 'OK' | 'FAR' | 'NOT_FOUND';

export interface CheckResult {
  status: CheckStatus;
  distanceM?: number;
  placeName?: string;
}

// a station whose coordinate is within this distance of the Kakao place is treated as matching
export const OK_DISTANCE_M = 300;
// a name match farther than OK_DISTANCE_M but within this distance is reported as a coordinate suspect
export const SEARCH_RADIUS_M = 2000;

// "강남역 2호선" -> "강남", "전대·에버랜드역" -> "전대에버랜드"
export function stationKey(name: string): string {
  const base = normalize(name.split(' ')[0]);
  return base.endsWith('역') && base.length > 2 ? base.slice(0, -1) : base;
}

// Only the verdict is kept. Kakao responses must not be stored, so nothing here is persisted.
export function classify(
  station: StationToCheck,
  places: KakaoPlace[],
): CheckResult {
  const wanted = stationKey(station.stationName);
  let best: CheckResult | undefined;
  for (const place of places) {
    if (place.category_group_code !== 'SW8') continue;
    if (stationKey(place.place_name) !== wanted) continue;
    const distanceM =
      distanceKm(station.lat, station.lng, Number(place.y), Number(place.x)) *
      1000;
    if (!best || distanceM < (best.distanceM ?? Infinity)) {
      best = { status: 'FAR', distanceM, placeName: place.place_name };
    }
  }
  if (!best) return { status: 'NOT_FOUND' };
  return {
    ...best,
    status: (best.distanceM ?? Infinity) <= OK_DISTANCE_M ? 'OK' : 'FAR',
  };
}
