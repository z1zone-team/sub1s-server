import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { RouteMode, ROUTE_MODES } from '../../../domain/subway/models/route';

export class RouteSearchRequestDto {
  @ApiPropertyOptional({
    description: '출발역 ID (직접 역 지정 시)',
    example: '0222',
  })
  @IsOptional()
  @IsString()
  originStationId?: string;

  @ApiPropertyOptional({
    description: '출발지 위도 (GPS 좌표 기준 도보 연계 시)',
    example: 37.4979,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  originLat?: number;

  @ApiPropertyOptional({
    description: '출발지 경도 (GPS 좌표 기준 도보 연계 시)',
    example: 127.0276,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  originLng?: number;

  @ApiPropertyOptional({
    description: '출발지 명칭 (예: 강남역 11번 출구 앞, 우리집 등)',
    example: '내 위치',
  })
  @IsOptional()
  @IsString()
  originName?: string;

  @ApiPropertyOptional({
    description: '도착역 ID (직접 역 지정 시)',
    example: '0234',
  })
  @IsOptional()
  @IsString()
  destinationStationId?: string;

  @ApiPropertyOptional({
    description: '도착지 위도 (GPS 좌표 기준 도보 연계 시)',
    example: 37.5665,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  destinationLat?: number;

  @ApiPropertyOptional({
    description: '도착지 경도 (GPS 좌표 기준 도보 연계 시)',
    example: 126.978,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  destinationLng?: number;

  @ApiPropertyOptional({
    description: '도착지 명칭 (예: 시청, 서울시청 앞 등)',
    example: '서울시청',
  })
  @IsOptional()
  @IsString()
  destinationName?: string;

  @ApiPropertyOptional({
    description:
      '경로 탐색 모드 (OPTIMAL, COMFORTABLE, PERSONAL, CHEAPEST, ONLY_WALK)',
    enum: ROUTE_MODES,
    example: 'OPTIMAL',
  })
  @IsOptional()
  @IsIn(ROUTE_MODES)
  routeMode?: RouteMode;

  @ApiPropertyOptional({
    description: '출발 희망 시각 (ISO-8601 포맷, 기본값: 현재 시각)',
    example: '2026-10-07T14:30:00Z',
  })
  @IsOptional()
  @IsISO8601()
  departureAt?: string;
}
