import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PLACE_KINDS, PlaceKind } from '../../../domain/user/models/place';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class PlaceKindParamDto {
  @ApiProperty({ enum: PLACE_KINDS, description: 'HOME 집, SCHOOL 학교' })
  @IsIn(PLACE_KINDS)
  kind!: PlaceKind;
}

export class SavePlaceRequestDto {
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
  @ValidateIf((dto: SavePlaceRequestDto) => dto.lat !== undefined || dto.lng !== undefined)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ description: '장소 경도. lat과 함께 보낸다', example: 126.978 })
  @ValidateIf((dto: SavePlaceRequestDto) => dto.lat !== undefined || dto.lng !== undefined)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}

export interface PlaceResponseDto {
  kind: PlaceKind;
  name: string;
  stationId: string | null;
  lat: number | null;
  lng: number | null;
}

export interface PlacesResponseDto {
  places: PlaceResponseDto[];
}

export interface RemovePlaceResponseDto {
  kind: PlaceKind;
  removed: boolean;
}
