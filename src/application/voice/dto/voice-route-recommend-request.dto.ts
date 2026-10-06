import { IsEnum, IsOptional, IsString } from 'class-validator';
import { RouteMode } from '../../../domain/subway/models/route';

export class VoiceRouteRecommendRequestDto {
  @IsOptional()
  @IsEnum(['OPTIMAL', 'COMFORTABLE', 'PERSONAL', 'CHEAPEST'], {
    message: 'preferredMode must be one of: OPTIMAL, COMFORTABLE, PERSONAL, CHEAPEST',
  })
  preferredMode?: RouteMode;

  @IsOptional()
  @IsString()
  transcriptHint?: string;
}
