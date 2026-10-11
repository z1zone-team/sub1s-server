import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { RouteMode } from '../../../domain/subway/models/route';

export class VoiceRouteRecommendRequestDto {
  @IsOptional()
  @IsEnum(['OPTIMAL', 'COMFORTABLE', 'PERSONAL', 'CHEAPEST'], {
    message:
      'preferredMode must be one of: OPTIMAL, COMFORTABLE, PERSONAL, CHEAPEST',
  })
  preferredMode?: RouteMode;

  @IsOptional()
  @IsString()
  transcriptHint?: string;

  /** 출발지를 말하지 않았을 때 쓰는 현재 위치 */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}
