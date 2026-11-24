import { StationVertical, TransferVertical } from '../models/station-vertical';

export const STATION_VERTICAL_REPOSITORY = Symbol(
  'STATION_VERTICAL_REPOSITORY',
);

export interface IStationVerticalRepository {
  /** 출입구-승강장 오르내림 자료가 없는 역이면 undefined */
  findStation(stationId: string): StationVertical | undefined;
  /** 환승 한 칸(transfers.json)의 오르내림. 환승 경로 자료가 없으면 undefined */
  findTransfer(
    fromStationId: string,
    toStationId: string,
  ): TransferVertical | undefined;
}
