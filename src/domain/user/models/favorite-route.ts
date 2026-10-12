/** 경로 즐겨찾기의 한쪽 끝(출발 또는 도착). 역이면 stationId, 장소면 좌표를 가진다 */
export interface FavoriteEndpoint {
  name: string;
  stationId: string | null;
  lat: number | null;
  lng: number | null;
}

/** 저장한 경로 즐겨찾기(출발 → 도착) */
export interface FavoriteRoute {
  id: string;
  origin: FavoriteEndpoint;
  destination: FavoriteEndpoint;
  createdAt: Date;
}

export type SaveFavoriteRoute = Pick<FavoriteRoute, 'origin' | 'destination'> & {
  /** 같은 경로를 두 번 저장하지 못하게 하는 값 */
  routeKey: string;
};

/** 사용자당 저장할 수 있는 경로 즐겨찾기의 수 */
export const FAVORITE_ROUTE_LIMIT = 20;

const COORD_DECIMALS = 4;

/** 역이면 역 ID, 장소면 좌표를 소수 넷째 자리(약 11m)로 반올림한 값. 이름은 바뀔 수 있어 쓰지 않는다 */
export function endpointKey(endpoint: Pick<FavoriteEndpoint, 'stationId' | 'lat' | 'lng'>): string {
  if (endpoint.stationId) return `S:${endpoint.stationId}`;
  const round = (value: number | null): string => (value ?? 0).toFixed(COORD_DECIMALS);
  return `P:${round(endpoint.lat)},${round(endpoint.lng)}`;
}

export function routeKeyOf(
  origin: Pick<FavoriteEndpoint, 'stationId' | 'lat' | 'lng'>,
  destination: Pick<FavoriteEndpoint, 'stationId' | 'lat' | 'lng'>,
): string {
  return `${endpointKey(origin)}>${endpointKey(destination)}`;
}
