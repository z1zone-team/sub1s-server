import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  NextTrainSource,
  NextTrainStatus,
  TrainDirection,
} from '../../../domain/arrival/ports/INextTrainProvider';

export const MAX_TRAINS_PER_DIRECTION = 5;
export const DEFAULT_TRAINS_PER_DIRECTION = 2;

export class NextTrainsQueryDto {
  @ApiPropertyOptional({
    description: '방향별로 돌려줄 열차 수 (1~5, 기본 2)',
    example: 2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_TRAINS_PER_DIRECTION)
  limit?: number = DEFAULT_TRAINS_PER_DIRECTION;
}

export class NextTrainDto {
  @ApiProperty({
    description: 'UP 상행, DOWN 하행, INNER 내선, OUTER 외선',
    enum: ['UP', 'DOWN', 'INNER', 'OUTER'],
  })
  direction!: TrainDirection;

  @ApiProperty({ description: '행선지(종착역) 이름', example: '중앙보훈병원' })
  headsign!: string;

  @ApiProperty({
    description: '도착까지 남은 초 (응답 시점 기준). 모르면 null',
    nullable: true,
    example: 120,
  })
  arrivalInSec!: number | null;

  @ApiProperty({ description: '도착 안내 문구', example: '2분 후 [1번째 전역]' })
  message!: string;

  @ApiProperty({ description: '급행 여부' })
  isExpress!: boolean;

  @ApiPropertyOptional({ description: '열차의 현재 위치 안내', example: '봉은사 진입' })
  currentLocation?: string;
}

export class NextTrainsResponseDto {
  @ApiProperty({ example: '09_925' })
  stationId!: string;

  @ApiProperty({ example: '신논현' })
  stationName!: string;

  @ApiProperty({ example: '09' })
  lineId!: string;

  @ApiProperty({
    description: '정보 출처. REALTIME 실시간, TIMETABLE 시각표',
    enum: ['REALTIME', 'TIMETABLE'],
  })
  source!: NextTrainSource;

  @ApiProperty({
    description:
      'OK 정상(열차가 없으면 빈 배열), UNSUPPORTED_LINE 이 노선은 정보 없음, UNAVAILABLE 일시적으로 가져오지 못함',
    enum: ['OK', 'UNSUPPORTED_LINE', 'UNAVAILABLE'],
  })
  status!: NextTrainStatus;

  @ApiProperty({ description: '정보를 가져온 시각 (KST ISO)' })
  updatedAt!: string;

  @ApiProperty({
    description: '방향별로 가까운 순서대로 정렬된 열차',
    type: [NextTrainDto],
  })
  trains!: NextTrainDto[];
}
