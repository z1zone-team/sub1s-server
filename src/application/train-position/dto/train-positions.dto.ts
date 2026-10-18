import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { TrainDirection } from '../../../domain/arrival/ports/INextTrainProvider';
import {
  TrainPositionSource,
  TrainPositionStatus,
} from '../../../domain/train-position/models/train-position';

export class TrainPositionsQueryDto {
  @ApiProperty({ description: '호선 ID (예: 02)', example: '02' })
  @IsString()
  @Matches(/^[0-9A-Z]{2}$/, { message: 'lineId는 두 글자 호선 ID여야 해요' })
  lineId!: string;
}

export type TrainPositionsStatus = 'OK' | 'NOT_COLLECTED' | 'UNSUPPORTED_LINE';

export interface TrainPositionItemDto {
  trainNo: string;
  stationName: string;
  /** 같은 호선에서 이 이름의 역 ID. 찾지 못하면 null */
  stationId: string | null;
  /** 이 역에 대한 상태. LEFT_PREVIOUS는 바로 앞 역을 출발해 이 역으로 가는 중 */
  status: TrainPositionStatus;
  direction: TrainDirection;
  destinationName: string;
  isExpress: boolean;
  isLastTrain: boolean;
}

export interface LineTrainPositionsDto {
  lineId: string;
  /** REALTIME 서울시 실시간, MOCK 시연용 가짜 열차 */
  source: TrainPositionSource;
  /** NOT_COLLECTED 아직 모으지 못함, UNSUPPORTED_LINE 서버가 모으지 않는 호선 */
  status: TrainPositionsStatus;
  /** 서버가 위치를 받은 시각(KST). 실시간이 아니라 이 시각의 위치다 */
  observedAt: string | null;
  /** 지금 시각 기준으로 받은 지 몇 초가 지났는지 */
  ageSec: number | null;
  /** 서버가 이 호선을 갱신하는 대략의 간격(초). 호선이 여러 개면 한 호선의 간격은 이보다 길다 */
  pollIntervalSec: number;
  trains: TrainPositionItemDto[];
}
