import { endpointKey, FavoriteEndpoint } from './favorite-route';

/** 저장한 장소 즐겨찾기(집, 학교와 별개). 역이면 stationId, 장소면 좌표를 가진다 */
export interface FavoritePlace extends FavoriteEndpoint {
  id: string;
  createdAt: Date;
}

export type SaveFavoritePlace = FavoriteEndpoint & {
  /** 같은 곳을 두 번 저장하지 못하게 하는 값 */
  placeKey: string;
};

/** 사용자당 저장할 수 있는 장소 즐겨찾기의 수 */
export const FAVORITE_PLACE_LIMIT = 20;

/** 경로 즐겨찾기와 같은 규칙이다. 역은 역 ID, 장소는 소수 넷째 자리(약 11m) 좌표 */
export const placeKeyOf = endpointKey;
