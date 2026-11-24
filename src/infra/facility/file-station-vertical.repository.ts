import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { getSubwayDataPath } from '../../common/utils/subway-data-path';
import {
  StationVertical,
  StationVerticalFile,
  TransferVertical,
  transferKey,
} from '../../domain/facility/models/station-vertical';
import { IStationVerticalRepository } from '../../domain/facility/ports/IStationVerticalRepository';

@Injectable()
export class FileStationVerticalRepository implements IStationVerticalRepository {
  private readonly file: StationVerticalFile;

  constructor() {
    this.file = JSON.parse(
      readFileSync(getSubwayDataPath('station-vertical.json'), 'utf-8'),
    ) as StationVerticalFile;
  }

  findStation(stationId: string): StationVertical | undefined {
    return Object.prototype.hasOwnProperty.call(this.file.stations, stationId)
      ? this.file.stations[stationId]
      : undefined;
  }

  findTransfer(
    fromStationId: string,
    toStationId: string,
  ): TransferVertical | undefined {
    const key = transferKey(fromStationId, toStationId);
    return Object.prototype.hasOwnProperty.call(this.file.transfers, key)
      ? this.file.transfers[key]
      : undefined;
  }
}
