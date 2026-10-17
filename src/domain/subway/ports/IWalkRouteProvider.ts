export const WALK_ROUTE_PROVIDER = Symbol('WALK_ROUTE_PROVIDER');

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** 실제 보행로를 따라 걷는 한 구간 */
export interface WalkLeg {
  /** 걷는 거리(m). 지점이 보행로에서 떨어져 있으면 그만큼을 직선으로 더한 값 */
  distanceM: number;
  /** 보행로를 따라가는 선. 구글 인코딩 폴리라인(정밀도 5, 위도 경도 순) */
  polyline: string;
}

/**
 * 두 지점 사이의 실제 보행 경로를 구한다. 지금은 OSM 데이터로 자체 호스팅하는 OSRM이 구현한다.
 * 서비스가 꺼져 있거나 응답하지 않거나 길을 찾지 못하면 null이고, 호출한 쪽은 직선 추정으로 되돌아간다
 */
export interface IWalkRouteProvider {
  route(from: GeoPoint, to: GeoPoint): Promise<WalkLeg | null>;
}
