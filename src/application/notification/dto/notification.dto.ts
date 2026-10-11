import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PushProvider } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterPushTokenRequestDto {
  @ApiProperty({
    description: '푸시 토큰. 앱의 getExpoPushTokenAsync() 결과 (ExponentPushToken[...])',
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  token!: string;

  @ApiPropertyOptional({
    description: '토큰 종류. 지금은 EXPO만 받는다 (기본 EXPO)',
    enum: PushProvider,
    default: 'EXPO',
  })
  @IsOptional()
  @IsEnum(PushProvider)
  provider?: PushProvider;

  @ApiPropertyOptional({ description: '기기 플랫폼', enum: ['ios', 'android'] })
  @IsOptional()
  @IsIn(['ios', 'android'])
  platform?: 'ios' | 'android';
}

export class RemovePushTokenQueryDto {
  @ApiProperty({ description: '삭제할 푸시 토큰 (URL 인코딩)' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  token!: string;
}

export class UpdateNotificationSettingsRequestDto {
  @ApiPropertyOptional({ description: '월말정산 푸시를 받을지 (기본 켜짐)' })
  @IsOptional()
  @IsBoolean()
  monthlySettlement?: boolean;
}

export interface NotificationSettingsResponseDto {
  monthlySettlement: boolean;
}

export interface PushTokenRegisteredResponseDto {
  registered: true;
}

export interface PushTokenRemovedResponseDto {
  removed: boolean;
}
