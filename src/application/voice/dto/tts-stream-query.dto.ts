import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** AI 음성 합성 비용과 긴 주소를 막기 위한 글자 수 상한 */
export const TTS_TEXT_MAX_LENGTH = 500;

export class TtsStreamQueryDto {
  @ApiProperty({
    description: `음성으로 만들 문장 (1~${TTS_TEXT_MAX_LENGTH}자, 앞뒤 공백 제거)`,
    example: '강남역에서 을지로입구역까지 최적 경로로 안내해 드릴게요.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(TTS_TEXT_MAX_LENGTH)
  text!: string;
}
