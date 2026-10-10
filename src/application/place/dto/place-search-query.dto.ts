import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PlaceSearchQueryDto {
  @ApiProperty({ description: '검색어 (역명, 건물명, 주소)', example: '강남' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  q!: string;

  @ApiPropertyOptional({
    description: '현재 위치 위도 (있으면 같은 이름의 역을 가까운 순으로 정렬)',
    example: 37.5665,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lat?: number;

  @ApiPropertyOptional({ description: '현재 위치 경도', example: 126.978 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lng?: number;

  @ApiPropertyOptional({
    description: '유형별 최대 개수 (기본 10)',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  limit?: number = 10;
}
