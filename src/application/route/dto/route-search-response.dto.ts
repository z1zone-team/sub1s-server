import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RouteMode } from '../../../domain/subway/models/route';
import {
  CongestionLevel,
  CongestionSource,
} from '../../../domain/congestion/models/congestion';
import { OperationStatus } from '../../../domain/operation/models/operation-status';
import {
  ROUTE_HIGHLIGHTS,
  RouteHighlight,
} from '../../../domain/subway/models/route-highlight';

export class OperationNoticeDto {
  @ApiProperty({ description: '서울교통공사 공지 제목', example: '2호선 이대역 안전문장애로 열차 무정차 통과중' })
  title!: string;

  @ApiProperty({ description: '공지가 올라온 시각 (KST ISO)' })
  occurredAt!: string;
}

const OPERATION_STATUS_DESCRIPTION =
  'NORMAL 서울교통공사가 공지한 이상 상황이 없음, DISRUPTED 지연·무정차 등 진행 중인 공지가 이 구간에 걸림, UNKNOWN 공지로 알 수 없음(도보, 공지가 빠짐없이 오지 않는 노선, 공지를 가져오지 못함)';

export class PathSegmentDto {
  @ApiProperty({
    description: '노선 ID (지하철 호선 또는 WALK)',
    example: '02',
  })
  lineId!: string;

  @ApiProperty({
    description: '행선 방향 (UP, DOWN, INNER, OUTER, NONE)',
    example: 'INNER',
  })
  direction!: 'UP' | 'DOWN' | 'INNER' | 'OUTER' | 'NONE';

  @ApiProperty({ description: '급행 여부', example: false })
  isExpress!: boolean;

  @ApiProperty({ description: '구간 출발역 ID', example: '0222' })
  fromStationId!: string;

  @ApiProperty({ description: '구간 출발역 명칭', example: '강남' })
  fromStationName!: string;

  @ApiProperty({ description: '구간 도착역 ID', example: '0234' })
  toStationId!: string;

  @ApiProperty({ description: '구간 도착역 명칭', example: '시청' })
  toStationName!: string;

  @ApiProperty({ description: '정차 역 수 (도보 구간은 0)', example: 12 })
  stationCount!: number;

  @ApiProperty({ description: '구간 소요 시간 (초)', example: 1440 })
  durationSec!: number;

  @ApiProperty({ description: '구간 이동 거리 (km)', example: 12.5 })
  distanceKm!: number;

  @ApiProperty({
    description: '추천 탑승 칸 번호 (1~10, 도보 시 0)',
    example: 4,
  })
  recommendedCarNo!: number;

  @ApiPropertyOptional({
    description: '환승/하차 추천 도어 번호 목록 (예: ["2-1", "4-4"])',
    example: ['2-1', '4-4'],
  })
  recommendedDoors?: string[];

  @ApiProperty({ description: '약냉방칸 여부', example: false })
  isWeakAirConditioned!: boolean;

  @ApiProperty({
    description: '혼잡도 수준 (여유, 보통, 혼잡)',
    example: '보통',
  })
  congestionLevel!: CongestionLevel;

  @ApiProperty({ description: '혼잡도 비율 (0~100%)', example: 52 })
  congestionRate!: number;

  @ApiProperty({
    description: OPERATION_STATUS_DESCRIPTION,
    enum: ['NORMAL', 'DISRUPTED', 'UNKNOWN'],
  })
  operationStatus!: OperationStatus;

  @ApiPropertyOptional({
    description: 'DISRUPTED일 때 근거가 된 공지',
    type: OperationNoticeDto,
  })
  operationNotice?: OperationNoticeDto;

  @ApiPropertyOptional({
    description:
      '혼잡도 출처 (STATISTICS: 서울교통공사 공표 통계, MOCK: 통계가 없는 역의 추정값). 도보 구간에는 없음',
    example: 'STATISTICS',
    enum: ['STATISTICS', 'MOCK'],
  })
  congestionSource?: CongestionSource;

  @ApiPropertyOptional({ description: '추정치 여부', example: false })
  isEstimated?: boolean;

  @ApiPropertyOptional({
    description: '도보 구간 소모 칼로리 (kcal)',
    example: 45,
  })
  walkCalories?: number;

  @ApiPropertyOptional({
    description: '도보 구간 걸음 수 (보)',
    example: 850,
  })
  walkSteps?: number;
}

export class SubwayRouteOptionDto {
  @ApiProperty({
    description:
      '경로 모드 (OPTIMAL, COMFORTABLE, PERSONAL, CHEAPEST, ONLY_WALK)',
    example: 'OPTIMAL',
  })
  mode!: RouteMode;

  @ApiProperty({
    description: '총 소요 시간 (초, 도보 + 지하철 + 환승)',
    example: 1800,
  })
  totalDurationSec!: number;

  @ApiProperty({
    description: '총 이동 거리 (km, 도보 + 지하철)',
    example: 14.2,
  })
  totalDistanceKm!: number;

  @ApiProperty({ description: '기본 요금 (원)', example: 1400 })
  totalFare!: number;

  @ApiProperty({ description: '환승 횟수', example: 1 })
  transferCount!: number;

  @ApiProperty({
    description: '예상 도착 시각 (ISO-8601)',
    example: '2026-10-07T15:10:00Z',
  })
  estimatedArrivalTimestamp!: string;

  @ApiProperty({
    description: '경로 세그먼트 목록 (도보 및 지하철)',
    type: [PathSegmentDto],
  })
  segments!: PathSegmentDto[];

  @ApiPropertyOptional({
    description:
      '지나가는 지하철역 ID를 순서대로 (출발역, 중간 역, 환승역, 도착역). ONLY_WALK에는 없음',
    type: [String],
    example: ['02_222', '02_221'],
  })
  stationIds?: string[];

  @ApiProperty({
    description:
      '이 옵션의 객관적 장점. 같은 응답의 다른 옵션과 비교해 정해진다. FASTEST 가장 빠름, FEWEST_TRANSFERS 환승 최소, NO_TRANSFER 환승 없음, LEAST_CROWDED 가장 한산함, LEAST_WALK 걷기 최소, CHEAPEST 최저 요금, WEAK_AC_CAR 약냉방칸이 있는 노선(1, 3~8호선)을 탑승 시간의 절반 이상 이용. 직접 도보 옵션은 빈 배열',
    enum: ROUTE_HIGHLIGHTS,
    isArray: true,
    example: ['FEWEST_TRANSFERS', 'WEAK_AC_CAR'],
  })
  highlights!: RouteHighlight[];

  @ApiProperty({
    description:
      '경로 전체의 운행 상태. 하나라도 DISRUPTED면 DISRUPTED, 모든 탑승 구간이 NORMAL일 때만 NORMAL, 그 밖에는 UNKNOWN',
    enum: ['NORMAL', 'DISRUPTED', 'UNKNOWN'],
  })
  operationStatus!: OperationStatus;

  @ApiPropertyOptional({
    description: 'DISRUPTED일 때 첫 번째 근거 공지',
    type: OperationNoticeDto,
  })
  operationNotice?: OperationNoticeDto;

  @ApiPropertyOptional({
    description: '총 도보 소요 시간 (초)',
    example: 360,
  })
  totalWalkDurationSec?: number;

  @ApiPropertyOptional({
    description: '총 도보 거리 (km)',
    example: 0.8,
  })
  totalWalkDistanceKm?: number;

  @ApiPropertyOptional({
    description: '총 도보 소모 칼로리 (kcal)',
    example: 52,
  })
  totalCalories?: number;

  @ApiPropertyOptional({
    description: '총 도보 걸음 수 (보)',
    example: 1040,
  })
  totalSteps?: number;
}

export class RouteSearchResultDto {
  @ApiProperty({
    description: '추천 경로 옵션 목록',
    type: [SubwayRouteOptionDto],
  })
  options!: SubwayRouteOptionDto[];

  @ApiPropertyOptional({
    description: 'AI 브리핑 가이드 텍스트',
    example: '강남역까지 도보 5분 이동 후 2호선을 탑승하세요.',
  })
  aiBriefingText?: string;
}
