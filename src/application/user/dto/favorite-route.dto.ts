import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** 경로 즐겨찾기의 출발 또는 도착. 집, 학교 즐겨찾기와 같은 규칙이다(역이면 stationId, 장소면 lat, lng) */
export class FavoriteEndpointDto {
  @ApiProperty({ description: '표시 이름 (1~100자)', example: '가양역' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    description: '지하철역이면 역 ID. 없으면 lat, lng가 필요하다',
    example: '09_907',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  stationId?: string;

  @ApiPropertyOptional({ description: '장소 위도. lng와 함께 보낸다', example: 37.5665 })
  @ValidateIf((dto: FavoriteEndpointDto) => dto.lat !== undefined || dto.lng !== undefined)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ description: '장소 경도. lat과 함께 보낸다', example: 126.978 })
  @ValidateIf((dto: FavoriteEndpointDto) => dto.lat !== undefined || dto.lng !== undefined)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}

export class SaveFavoriteRouteRequestDto {
  @ApiProperty({ type: FavoriteEndpointDto })
  @ValidateNested()
  @Type(() => FavoriteEndpointDto)
  origin!: FavoriteEndpointDto;

  @ApiProperty({ type: FavoriteEndpointDto })
  @ValidateNested()
  @Type(() => FavoriteEndpointDto)
  destination!: FavoriteEndpointDto;
}

export class FavoriteRouteIdParamDto {
  @ApiProperty({ description: '즐겨찾기 ID', example: '0b6d3a2e-6b0e-4d9a-9a52-1d3f0c1b2a4e' })
  @IsUUID()
  id!: string;
}

export interface FavoriteEndpointResponseDto {
  name: string;
  stationId: string | null;
  lat: number | null;
  lng: number | null;
}

export interface FavoriteRouteResponseDto {
  id: string;
  origin: FavoriteEndpointResponseDto;
  destination: FavoriteEndpointResponseDto;
  /** 저장한 시각(한국 시간 ISO-8601) */
  createdAt: string;
}

export interface FavoriteRoutesResponseDto {
  favorites: FavoriteRouteResponseDto[];
  /** 저장할 수 있는 최대 개수 */
  limit: number;
}

export interface SaveFavoriteRouteResponseDto extends FavoriteRouteResponseDto {
  /** 이미 저장되어 있던 경로면 true(새로 만들지 않고 그 항목을 돌려줌) */
  alreadySaved: boolean;
}

export interface RemoveFavoriteRouteResponseDto {
  id: string;
  removed: boolean;
}
