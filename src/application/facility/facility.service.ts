import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import {
  IStationFacilityRepository,
  STATION_FACILITY_REPOSITORY,
} from '../../domain/facility/ports/IStationFacilityRepository';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { StationFacilitiesResponseDto } from './dto/station-facilities.dto';

@Injectable()
export class FacilityService {
  constructor(
    @Inject(STATION_FACILITY_REPOSITORY)
    private readonly repository: IStationFacilityRepository,
    private readonly graphService: SubwayGraphService,
  ) {}

  getFacilities(stationId: string): StationFacilitiesResponseDto {
    const graph = this.graphService.getGraph();
    const index = graph.indexOf(stationId);
    if (index === undefined) {
      throw new BusinessException(
        'STATION_NOT_FOUND',
        `station not found: ${stationId}`,
        HttpStatus.NOT_FOUND,
      );
    }
    const station = graph.station(index);
    const base = {
      stationId,
      stationName: station.stationName,
      lineId: station.lineId,
    };

    const facilities = this.repository.findByStationId(stationId);
    if (!facilities) {
      return { ...base, available: false, hasElevator: null, elevatorDoors: [], exits: [] };
    }
    return {
      ...base,
      available: true,
      hasElevator: facilities.elevatorDoors.length > 0,
      elevatorDoors: facilities.elevatorDoors,
      exits: facilities.exits,
    };
  }
}
