import { Type } from 'class-transformer';
import { IsEnum, IsInt, Max, Min } from 'class-validator';

/**
 * 다른 사용자의 이동 기록 조회 요청. 대상 사용자는 경로의 :userId로 받는다.
 * 내 기록 조회(TimelineQueryDto 등)와 따로 두어 공개 정책이 바뀌어도 내 기록 API에 영향이 없게 한다
 */
export class UserTimelineQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}

export class UserTravelStatsQueryDto {
  @IsEnum(['WEEK', 'MONTH', 'YEAR', 'ALL'], {
    message: 'period must be one of: WEEK, MONTH, YEAR, ALL',
  })
  period!: 'WEEK' | 'MONTH' | 'YEAR' | 'ALL';
}

export class UserLineMapQueryDto {
  @IsEnum(['WEEK', 'MONTH', 'YEAR', 'ALL'], {
    message: 'period must be one of: WEEK, MONTH, YEAR, ALL',
  })
  period!: 'WEEK' | 'MONTH' | 'YEAR' | 'ALL';
}
