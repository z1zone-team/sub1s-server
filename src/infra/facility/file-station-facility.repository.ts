import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { getSubwayDataPath } from '../../common/utils/subway-data-path';
import {
  StationFacilities,
  StationFacilitiesFile,
} from '../../domain/facility/models/station-facilities';
import { IStationFacilityRepository } from '../../domain/facility/ports/IStationFacilityRepository';

@Injectable()
export class FileStationFacilityRepository implements IStationFacilityRepository {
  private readonly stations: Record<string, StationFacilities>;

  constructor() {
    const file = JSON.parse(
      readFileSync(getSubwayDataPath('station-facilities.json'), 'utf-8'),
    ) as StationFacilitiesFile;
    this.stations = file.stations;
  }

  findByStationId(stationId: string): StationFacilities | undefined {
    return Object.prototype.hasOwnProperty.call(this.stations, stationId)
      ? this.stations[stationId]
      : undefined;
  }
}
