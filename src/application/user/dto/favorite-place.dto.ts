import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { FavoriteEndpointDto } from './favorite-route.dto';

/** 장소 즐겨찾기 저장. 경로 즐겨찾기의 한쪽 끝과 같은 규칙이다(역이면 stationId, 장소면 lat, lng) */
export class SaveFavoritePlaceRequestDto extends FavoriteEndpointDto {}

export class FavoritePlaceIdParamDto {
  @ApiProperty({
    description: '장소 즐겨찾기 ID',
    example: '0b6d3a2e-6b0e-4d9a-9a52-1d3f0c1b2a4e',
  })
  @IsUUID()
  id!: string;
}

export interface FavoritePlaceResponseDto {
  id: string;
  name: string;
  stationId: string | null;
  lat: number | null;
  lng: number | null;
  /** 저장한 시각(한국 시간 ISO-8601) */
  createdAt: string;
}

export interface FavoritePlacesResponseDto {
  places: FavoritePlaceResponseDto[];
  /** 저장할 수 있는 최대 개수 */
  limit: number;
}

export interface SaveFavoritePlaceResponseDto extends FavoritePlaceResponseDto {
  /** 이미 저장되어 있던 곳이면 true(새로 만들지 않고 그 항목을 돌려줌) */
  alreadySaved: boolean;
}

export interface RemoveFavoritePlaceResponseDto {
  id: string;
  removed: boolean;
}
