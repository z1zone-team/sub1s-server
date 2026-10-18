export const PLACE_SEARCH_PROVIDER = Symbol('PLACE_SEARCH_PROVIDER');

export const ROAD_ADDRESS_CATEGORY = '도로명주소';
export const PARCEL_ADDRESS_CATEGORY = '지번주소';
// 주소로 찾은 결과의 `category`. 같은 주소가 여러 도시에 있을 수 있어 현재 위치에서 가까운 순으로 보여 준다
export const ADDRESS_PLACE_CATEGORIES: readonly string[] = [
  ROAD_ADDRESS_CATEGORY,
  PARCEL_ADDRESS_CATEGORY,
];

export interface ExternalPlace {
  name: string;
  address: string;
  category?: string;
  lat: number;
  lng: number;
}

export interface ReverseGeocodeResult {
  name: string;
  address: string;
  category: string;
}

export interface IPlaceSearchProvider {
  search(query: string, limit: number): Promise<ExternalPlace[]>;
  /** 좌표의 도로명 주소(없으면 지번 주소). 찾지 못했거나 호출이 막혔으면 null */
  reverse(lat: number, lng: number): Promise<ReverseGeocodeResult | null>;
}
