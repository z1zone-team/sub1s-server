export const PLACE_KINDS = ['HOME', 'SCHOOL'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** 집이나 학교. 역이면 stationId, 장소면 좌표를 가진다 */
export interface UserPlace {
  kind: PlaceKind;
  name: string;
  stationId: string | null;
  lat: number | null;
  lng: number | null;
}

export type SaveUserPlace = Omit<UserPlace, 'kind'>;
