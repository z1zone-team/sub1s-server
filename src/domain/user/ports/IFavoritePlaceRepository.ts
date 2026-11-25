import { FavoritePlace, SaveFavoritePlace } from '../models/favorite-place';

export const FAVORITE_PLACE_REPOSITORY = Symbol('FAVORITE_PLACE_REPOSITORY');

export interface IFavoritePlaceRepository {
  /** 최근에 저장한 순서 */
  findAll(userId: string): Promise<FavoritePlace[]>;
  count(userId: string): Promise<number>;
  /** 같은 곳(placeKey)이 이미 있으면 그것을 돌려주고 새로 만들지 않는다 */
  findByKey(userId: string, placeKey: string): Promise<FavoritePlace | null>;
  create(userId: string, place: SaveFavoritePlace): Promise<FavoritePlace>;
  /** 지웠으면 true, 원래 없었거나 다른 사용자의 것이면 false */
  remove(userId: string, id: string): Promise<boolean>;
}
