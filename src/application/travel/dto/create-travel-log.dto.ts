import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTravelLogDto {
  @IsString()
  @IsNotEmpty()
  originStationId!: string;

  @IsString()
  @IsNotEmpty()
  destStationId!: string;

  @IsString()
  @IsOptional()
  sessionId?: string;
}
