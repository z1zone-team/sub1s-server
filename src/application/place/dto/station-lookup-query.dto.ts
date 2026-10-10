import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export const MAX_STATION_LOOKUP_IDS = 20;

export class StationLookupQueryDto {
  @ApiProperty({
    description: '조회할 역 ID 목록 (쉼표 구분, 최대 20개)',
    example: '02_222,09_925',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_STATION_LOOKUP_IDS)
  @IsString({ each: true })
  ids!: string[];
}
