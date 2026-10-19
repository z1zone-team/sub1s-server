import { ServiceDailyRow, TrainObservation } from '../models/train-observation';

export const TRAIN_OBSERVATION_REPOSITORY = Symbol('TRAIN_OBSERVATION_REPOSITORY');

export interface ITrainObservationRepository {
  saveMany(observations: TrainObservation[]): Promise<void>;
  /** from 이상 to 미만 */
  findBetween(from: Date, to: Date): Promise<TrainObservation[]>;
  /** 같은 운행일, 역, 방향이 있으면 덮어쓴다 */
  upsertDaily(rows: ServiceDailyRow[]): Promise<void>;
  /** before 이전 관측을 지우고 지운 수를 돌려준다 */
  deleteObservationsBefore(before: Date): Promise<number>;
}
