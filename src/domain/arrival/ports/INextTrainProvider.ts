export const NEXT_TRAIN_PROVIDER = Symbol('NEXT_TRAIN_PROVIDER');

export type TrainDirection = 'UP' | 'DOWN' | 'INNER' | 'OUTER';
export type NextTrainSource = 'REALTIME' | 'TIMETABLE';
export type NextTrainStatus = 'OK' | 'UNSUPPORTED_LINE' | 'UNAVAILABLE';

export interface NextTrain {
  direction: TrainDirection;
  headsign: string;
  /** observedAt 시점 기준 도착까지 남은 초. 모르면 null */
  arrivalInSec: number | null;
  message: string;
  isExpress: boolean;
  currentLocation?: string;
}

export interface NextTrainSnapshot {
  source: NextTrainSource;
  status: NextTrainStatus;
  observedAt: Date;
  trains: NextTrain[];
}

export interface NextTrainQuery {
  stationId: string;
  lineId: string;
  stationName: string;
}

export interface INextTrainProvider {
  fetchNextTrains(query: NextTrainQuery): Promise<NextTrainSnapshot>;
}
