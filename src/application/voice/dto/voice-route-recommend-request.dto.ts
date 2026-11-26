import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RouteMode } from '../../../domain/subway/models/route';

/** 음성으로 고를 수 있는 경로 모드(걷기만 하는 ONLY_WALK 제외) */
const VOICE_ROUTE_MODES: RouteMode[] = [
  'OPTIMAL',
  'COMFORTABLE',
  'PERSONAL',
  'CHEAPEST',
  'FASTEST',
  'LEAST_WALK',
  'FEWEST_TRANSFERS',
];

export class VoiceRouteRecommendRequestDto {
  @IsOptional()
  @IsEnum(VOICE_ROUTE_MODES, {
    message: `preferredMode must be one of: ${VOICE_ROUTE_MODES.join(', ')}`,
  })
  preferredMode?: RouteMode;

  /** 앱이 기기에서 받아 적은 문장. 있으면 서버 음성 인식을 건너뛰고 오디오 파일 없이 보내도 된다 */
  @IsOptional()
  @IsString()
  @MaxLength(300)
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
