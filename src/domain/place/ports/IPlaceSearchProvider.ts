export const PLACE_SEARCH_PROVIDER = Symbol('PLACE_SEARCH_PROVIDER');

export interface ExternalPlace {
  name: string;
  address: string;
  category?: string;
  lat: number;
  lng: number;
}

export interface IPlaceSearchProvider {
  search(query: string, limit: number): Promise<ExternalPlace[]>;
}
