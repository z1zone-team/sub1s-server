import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TrainCongestionQueryDto {
  @IsNotEmpty()
  @IsString()
  lineId!: string;

  @IsNotEmpty()
  @IsString()
  trainId!: string;

  @IsNotEmpty()
  @IsString()
  stationId!: string;

  @IsOptional()
  @IsString()
  direction?: string;
}
