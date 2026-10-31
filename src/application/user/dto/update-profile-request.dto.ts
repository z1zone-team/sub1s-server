import { ApiPropertyOptional } from '@nestjs/swagger';
import { RankingVisibility } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  NAME_MAX_LENGTH,
  NICKNAME_PATTERN,
  normalizeNickname,
} from '../../../domain/user/models/nickname';

const normalize = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? normalizeNickname(value) : value;

export class UpdateProfileRequestDto {
  @ApiPropertyOptional({
    description: '이름 (1~30자). null이면 지웁니다',
    example: '박지훈',
    nullable: true,
  })
  @IsOptional()
  @Transform(normalize)
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX_LENGTH)
  name?: string | null;

  @ApiPropertyOptional({
    description: '닉네임 (2~20자, 한글/영문/숫자/_/./-). 대소문자 구분 없이 중복 불가',
    example: '내출신은리',
  })
  @IsOptional()
  @Transform(normalize)
  @Matches(NICKNAME_PATTERN, {
    message: 'nickname must be 2-20 characters of Hangul, letters, digits, _, . or -',
  })
  nickname?: string;

  @ApiPropertyOptional({
    description: '이동 기록 공개 범위. 친구에게는 항상 공개하고, 친구가 아닌 사람에게 PUBLIC 전체, ANONYMOUS 익명, PRIVATE 비공개',
    enum: RankingVisibility,
  })
  @IsOptional()
  @IsEnum(RankingVisibility)
  rankingVisibility?: RankingVisibility;
}
