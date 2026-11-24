import { IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class LineMapQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId?: string;

  @IsEnum(['WEEK', 'MONTH', 'YEAR', 'ALL'], {
    message: 'period must be one of: WEEK, MONTH, YEAR, ALL',
  })
  period: 'WEEK' | 'MONTH' | 'YEAR' | 'ALL';

  @ApiPropertyOptional({
    description: 'MONTH 조회 대상 월(YYYY-MM, 2000~2100년). 생략하면 이번 달',
    example: '2026-10',
  })
  @IsOptional()
  @Matches(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/)
  periodKey?: string;
}
