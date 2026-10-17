export const PLACE_SEARCH_PROVIDER = Symbol('PLACE_SEARCH_PROVIDER');

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
