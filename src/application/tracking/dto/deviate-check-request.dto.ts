import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DeviateCheckRequestDto {
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  detectedStationId!: string;

  @IsBoolean()
  @IsOptional()
  isUserConfirmed?: boolean;
}
