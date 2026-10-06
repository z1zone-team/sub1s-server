import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class RankingQueryDto {
  @IsString()
  @IsIn(['MONTHLY', 'ALL'])
  periodType: 'MONTHLY' | 'ALL' = 'MONTHLY';

  @IsString()
  periodKey!: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  friendsOnly?: boolean = false;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}
