import {
  LineTrainPositions,
  TrainPositionSource,
} from '../models/train-position';

export const TRAIN_POSITION_PROVIDER = Symbol('TRAIN_POSITION_PROVIDER');

export interface ITrainPositionProvider {
  readonly source: TrainPositionSource;
  /** 이 공급자가 위치를 가져올 수 있는 호선인지 */
  supports(lineId: string): boolean;
  /** 한 호선의 열차 위치. 가져오지 못하면 null (호출 실패, 키 없음, 응답 오류) */
  fetchLine(lineId: string): Promise<LineTrainPositions | null>;
}
