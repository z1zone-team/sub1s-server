import { StationFacilities } from '../models/station-facilities';

export const STATION_FACILITY_REPOSITORY = Symbol('STATION_FACILITY_REPOSITORY');

export interface IStationFacilityRepository {
  /** 편의시설 자료가 없는 역이면 undefined */
  findByStationId(stationId: string): StationFacilities | undefined;
}
