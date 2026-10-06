import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class JoinTrainDto {
  @IsString()
  @IsNotEmpty()
  lineId!: string;

  @IsString()
  @IsNotEmpty()
  trainId!: string;

  @IsString()
  @IsOptional()
  stationId?: string;
}
