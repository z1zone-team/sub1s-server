import { IsNotEmpty, IsString } from 'class-validator';

export class ReportLocationDto {
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  currentStationId!: string;
}
