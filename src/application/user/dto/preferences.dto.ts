import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn } from 'class-validator';
import {
  ROUTE_PREFS,
  RoutePref,
  TRAVEL_PURPOSES,
  TravelPurpose,
  dedupe,
} from '../../../domain/user/models/preferences';

const unique = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) ? dedupe(value) : value;

export class UpdatePreferencesRequestDto {
  @ApiProperty({
    description:
      '주로 타는 용무 (1개 이상, 중복 제거). COMMUTE 출퇴근, SCHOOL 통학, MEETING 약속·모임, TRAVEL 여행, EXERCISE 운동, SHOPPING 쇼핑, HOSPITAL 병원, DATE 데이트',
    enum: TRAVEL_PURPOSES,
    isArray: true,
    example: ['COMMUTE', 'MEETING'],
  })
  @Transform(unique)
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(TRAVEL_PURPOSES, { each: true })
  purposes!: TravelPurpose[];

  @ApiProperty({
    description:
      '선호 경로 취향 (1개 이상, 중복 제거). FAST 빠르게, FEW_TRANSFERS 환승 적게, WEAK_AC 약냉방칸, UNCROWDED 덜 붐비게, LESS_WALK 덜 걷게, SEAT 앉아서 가기, ELEVATOR 엘리베이터 있는 역',
    enum: ROUTE_PREFS,
    isArray: true,
    example: ['FAST', 'UNCROWDED'],
  })
  @Transform(unique)
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ROUTE_PREFS, { each: true })
  routePrefs!: RoutePref[];
}

export interface PreferencesResponseDto {
  purposes: TravelPurpose[];
  routePrefs: RoutePref[];
}
