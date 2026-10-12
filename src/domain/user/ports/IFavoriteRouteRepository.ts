import { FavoriteRoute, SaveFavoriteRoute } from '../models/favorite-route';

export const FAVORITE_ROUTE_REPOSITORY = Symbol('FAVORITE_ROUTE_REPOSITORY');

export interface IFavoriteRouteRepository {
  /** 최근에 저장한 순서 */
  findAll(userId: string): Promise<FavoriteRoute[]>;
  count(userId: string): Promise<number>;
  /** 같은 경로(routeKey)가 이미 있으면 그것을 돌려주고 새로 만들지 않는다 */
  findByKey(userId: string, routeKey: string): Promise<FavoriteRoute | null>;
  create(userId: string, favorite: SaveFavoriteRoute): Promise<FavoriteRoute>;
  /** 지웠으면 true, 원래 없었거나 다른 사용자의 것이면 false */
  remove(userId: string, id: string): Promise<boolean>;
}
