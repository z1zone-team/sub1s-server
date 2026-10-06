import { IsNotEmpty, IsString } from 'class-validator';

export class ReportLocationRequestDto {
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  currentStationId!: string;
}
