import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class AcceptInviteRequestDto {
  @ApiProperty({
    description: '초대 링크에 들어 있는 토큰',
    example: 'k3J9xQ2mT7vB',
  })
  @IsString()
  @Length(8, 32)
  @Matches(/^[A-Za-z0-9_-]+$/)
  inviteToken!: string;
}

export interface FriendDto {
  userId: string;
  nickname: string;
  profileImageUrl: string | null;
  friendedAt: string;
}

export interface FriendListResponseDto {
  totalCount: number;
  friends: FriendDto[];
}

export interface InviteTokenResponseDto {
  inviteToken: string;
}

export interface RemoveFriendResponseDto {
  friendId: string;
}
