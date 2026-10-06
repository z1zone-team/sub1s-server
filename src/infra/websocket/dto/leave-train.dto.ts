import { IsNotEmpty, IsString } from 'class-validator';

export class LeaveTrainDto {
  @IsString()
  @IsNotEmpty()
  lineId!: string;

  @IsString()
  @IsNotEmpty()
  trainId!: string;
}
