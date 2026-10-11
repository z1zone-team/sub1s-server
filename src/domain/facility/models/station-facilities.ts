export interface ExitFacility {
  name: string;
  address: string | null;
}

export interface StationExit {
  exitNo: string;
  facilities: ExitFacility[];
}

export interface StationFacilities {
  exits: StationExit[];
  /** 엘리베이터에서 가까운 문. 칸-문 번호이며 경로의 recommendedDoors와 같은 형식 */
  elevatorDoors: string[];
}

export interface StationFacilitiesFile {
  stations: Record<string, StationFacilities>;
}
