import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_FREQUENT_DAYS = 30;
export const MAX_FREQUENT_DAYS = 90;
export const DEFAULT_FREQUENT_LIMIT = 3;
export const MAX_FREQUENT_LIMIT = 10;
/** 한 번 다닌 경로는 "자주 가는 경로"로 보지 않는다 */
export const MIN_FREQUENT_TRIPS = 2;

export class FrequentRoutesQueryDto {
  @ApiPropertyOptional({
    description:
      '오늘(KST)을 포함해 며칠 전까지의 이동 기록을 볼지 (1~90, 기본 30)',
    example: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_FREQUENT_DAYS)
  days?: number = DEFAULT_FREQUENT_DAYS;

  @ApiPropertyOptional({
    description: '돌려줄 경로 수 (1~10, 기본 3)',
    example: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_FREQUENT_LIMIT)
  limit?: number = DEFAULT_FREQUENT_LIMIT;
}

export class FrequentRouteDto {
  @ApiProperty({ example: '09_909' })
  originStationId!: string;

  @ApiProperty({ example: '가양' })
  originStationName!: string;

  @ApiProperty({ example: '09_925' })
  destStationId!: string;

  @ApiProperty({ example: '신논현' })
  destStationName!: string;

  @ApiProperty({
    description: '기간 안에 이 출발·도착 역으로 이동을 완료한 횟수',
    example: 6,
  })
  tripCount!: number;

  @ApiProperty({
    description: '마지막으로 다닌 시각(KST)',
    example: '2026-11-24T08:41:00.000+09:00',
  })
  lastTraveledAt!: string;
}

export class FrequentRoutesResponseDto {
  @ApiProperty({
    description: '조회 시작 시각(KST 자정)',
    example: '2026-10-28T00:00:00.000+09:00',
  })
  since!: string;

  @ApiProperty({
    description: `${MIN_FREQUENT_TRIPS}번 이상 다닌 경로만, 횟수가 많은 순(같으면 최근 순)`,
  })
  routes!: FrequentRouteDto[];
}
