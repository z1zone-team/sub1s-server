import { PlaceKind, SaveUserPlace, UserPlace } from '../models/place';

export const USER_PLACE_REPOSITORY = Symbol('USER_PLACE_REPOSITORY');

export interface IUserPlaceRepository {
  findAll(userId: string): Promise<UserPlace[]>;
  /** 같은 종류가 있으면 교체한다 */
  save(userId: string, kind: PlaceKind, place: SaveUserPlace): Promise<UserPlace>;
  /** 지웠으면 true, 원래 없었으면 false */
  remove(userId: string, kind: PlaceKind): Promise<boolean>;
}
