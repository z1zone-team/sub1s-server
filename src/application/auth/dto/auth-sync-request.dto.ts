import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AuthSyncRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nickname?: string;

  @IsOptional()
  @IsString()
  profileImageUrl?: string;
}
