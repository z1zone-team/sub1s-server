import { ApiProperty } from '@nestjs/swagger';

export class ExitFacilityDto {
  @ApiProperty({ description: '출구 주변 시설 이름', example: '강남358타워' })
  name!: string;

  @ApiProperty({
    description: '시설 주소. 없으면 null',
    nullable: true,
    example: '서울특별시 강남구 테헤란로 358',
  })
  address!: string | null;
}

export class StationExitDto {
  @ApiProperty({ description: '출구 번호 (가지 출구는 "2-1")', example: '2' })
  exitNo!: string;

  @ApiProperty({ type: [ExitFacilityDto], description: '출구 주변 주요 시설' })
  facilities!: ExitFacilityDto[];
}

export class StationFacilitiesResponseDto {
  @ApiProperty({ example: '02_222' })
  stationId!: string;

  @ApiProperty({ example: '강남' })
  stationName!: string;

  @ApiProperty({ example: '02' })
  lineId!: string;

  @ApiProperty({
    description:
      'false이면 이 역의 편의시설 자료가 아직 없다는 뜻이며 나머지 값은 비어 있다',
  })
  available!: boolean;

  @ApiProperty({
    description:
      '엘리베이터와 가까운 문이 있는지. 자료가 없는 역(available=false)은 null',
    nullable: true,
  })
  hasElevator!: boolean | null;

  @ApiProperty({
    description:
      '엘리베이터와 가까운 문 목록 (칸-문 번호). 경로의 recommendedDoors와 같은 형식이다',
    type: [String],
    example: ['3-4', '8-1'],
  })
  elevatorDoors!: string[];

  @ApiProperty({ type: [StationExitDto], description: '출구 번호 순' })
  exits!: StationExitDto[];
}
