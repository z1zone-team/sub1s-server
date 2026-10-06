import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class TravelStatsQueryDto {
  @IsEnum(['WEEK', 'MONTH', 'YEAR', 'ALL'], {
    message: 'period must be one of: WEEK, MONTH, YEAR, ALL',
  })
  period: 'WEEK' | 'MONTH' | 'YEAR' | 'ALL';

  @IsOptional()
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId?: string;
}
