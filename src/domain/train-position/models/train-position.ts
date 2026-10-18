import { TrainDirection } from '../../arrival/ports/INextTrainProvider';

/**
 * 열차가 가리키는 역(`stationName`)에 대한 상태.
 * 서울시 `trainSttus`의 0 진입, 1 도착, 2 출발, 3 전역출발(바로 앞 역을 출발해 이 역으로 가는 중)이고 그 밖의 값은 UNKNOWN이다
 */
export type TrainPositionStatus =
  'ENTERING' | 'ARRIVED' | 'DEPARTED' | 'LEFT_PREVIOUS' | 'UNKNOWN';

export type TrainPositionSource = 'REALTIME' | 'MOCK';

export interface TrainPosition {
  trainNo: string;
  stationName: string;
  status: TrainPositionStatus;
  direction: TrainDirection;
  /** 종착역 이름. 모르면 빈 문자열 */
  destinationName: string;
  isExpress: boolean;
  isLastTrain: boolean;
}

/** 한 호선의 열차 위치를 한 번에 받은 결과 */
export interface LineTrainPositions {
  lineId: string;
  source: TrainPositionSource;
  observedAt: Date;
  trains: TrainPosition[];
}
