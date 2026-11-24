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
  @ApiProperty({
    description: '서울교통공사 공지 제목',
    example: '2호선 이대역 안전문장애로 열차 무정차 통과중',
  })
  title!: string;

  @ApiProperty({ description: '공지가 올라온 시각 (KST ISO)' })
  occurredAt!: string;
}

export class ServiceHoursDto {
  @ApiProperty({
    description:
      'BEFORE_FIRST_TRAIN 탑승역에 도착하는 시각이 이 방향 첫차보다 이름, AFTER_LAST_TRAIN 막차가 이미 떠난 뒤임',
    enum: ['BEFORE_FIRST_TRAIN', 'AFTER_LAST_TRAIN'],
  })
  status!: 'BEFORE_FIRST_TRAIN' | 'AFTER_LAST_TRAIN';

  @ApiProperty({ description: '탑승 시각이 속한 운행일의 첫차 출발 시각 (KST ISO)' })
  firstTrainAt!: string;

  @ApiProperty({ description: '탑승 시각이 속한 운행일의 막차 출발 시각 (KST ISO)' })
  lastTrainAt!: string;

  @ApiPropertyOptional({
    description:
      '다음에 탈 수 있는 첫차 출발 시각 (KST ISO). 첫차 전이면 그날 첫차, 막차 뒤이면 다음 운행일 첫차. 다음 운행일 시간표가 없으면 생략',
  })
  nextTrainAt?: string;
}

export class ServiceWarningDto {
  @ApiProperty({ enum: ['BEFORE_FIRST_TRAIN', 'AFTER_LAST_TRAIN'] })
  status!: 'BEFORE_FIRST_TRAIN' | 'AFTER_LAST_TRAIN';

  @ApiProperty({ description: '열차가 없는 탑승 구간의 노선 ID', example: '02' })
  lineId!: string;

  @ApiProperty({ description: '열차가 없는 탑승역 ID', example: '02_222' })
  stationId!: string;

  @ApiProperty({ description: '열차가 없는 탑승역 이름', example: '강남' })
  stationName!: string;

  @ApiPropertyOptional({ description: '그 역에서 다음에 탈 수 있는 첫차 출발 시각 (KST ISO)' })
  nextTrainAt?: string;

  @ApiPropertyOptional({
    description:
      '그 역의 다음 첫차를 탈 수 있게 맞춘 출발 시각 (KST ISO). 이 값을 departureAt으로 다시 검색하면 된다',
  })
  suggestedDepartureAt?: string;
}

const OPERATION_STATUS_DESCRIPTION =
  'NORMAL 서울교통공사가 공지한 이상 상황이 없음, DISRUPTED 지연·무정차 등 진행 중인 공지가 이 구간에 걸림, UNKNOWN 공지로 알 수 없음(도보, 공지가 빠짐없이 오지 않는 노선, 공지를 가져오지 못함)';

export class SegmentCarDto {
  @ApiProperty({
    description: '칸 번호 (1부터 그 열차의 칸 수까지)',
    example: 3,
  })
  carNo!: number;

  @ApiProperty({ description: '혼잡도 % (0~100)', example: 42 })
  rate!: number;

  @ApiProperty({ description: '혼잡도 단계', enum: ['여유', '보통', '혼잡'] })
  level!: CongestionLevel;

  @ApiProperty({ description: '약냉방칸 여부' })
  isWeakAirConditioned!: boolean;
}

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
    description:
      '추천 탑승 칸 번호 (1부터 그 열차의 칸 수까지). 도보 구간이나 칸 수를 모르는 노선은 0',
    example: 4,
  })
  recommendedCarNo!: number;

  @ApiPropertyOptional({
    description: '환승/하차 추천 도어 번호 목록 (예: ["2-1", "4-4"])',
    example: ['2-1', '4-4'],
  })
  recommendedDoors?: string[];

  @ApiPropertyOptional({
    description:
      '이 구간 출발역에 도착하는 예상 시각 (KST ISO). 출발 시각에 앞 구간의 이동과 환승 걷기를 더한 값. 도보 구간에는 없음',
  })
  boardingAt?: string;

  @ApiPropertyOptional({
    description:
      '그 시각에 탈 열차가 없을 때만 있음. 시간표가 없는 노선이나 요일은 알 수 없어 없음',
    type: ServiceHoursDto,
  })
  serviceHours?: ServiceHoursDto;

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

  @ApiPropertyOptional({
    description:
      '이 구간 출발역의 칸별 예측 혼잡도(그 열차의 칸 수만큼, 예: 1~4호선 10칸, 5~7호선 8칸, 8, 9호선 6칸). 추천 칸은 이 중 가장 한산한 칸이다. 도보 구간과 칸 수를 모르는 노선에는 없거나 빈 배열',
    type: [SegmentCarDto],
  })
  cars?: SegmentCarDto[];

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

  @ApiPropertyOptional({
    description:
      '구간의 경로 선. 구글 인코딩 폴리라인(정밀도 5, 위도 경도 순). 도보 구간은 실제 보행로를, 열차 구간은 실제 선로 모양(OpenStreetMap 기반)을 따른다. 보행 경로나 선로 모양을 구하지 못한 구간에는 없고, 그때는 역 또는 지점의 좌표를 직선으로 이으면 된다',
    example: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
  })
  path?: string;
}

export class SubwayRouteOptionDto {
  familiarity?: number;
  elevatorAccess?: number;
  /** 승차, 하차, 환승에서 오르내리는 높이(m). 계단 축(stairs) 근거. 자료가 없는 역이 있으면 undefined */
  verticalTravelM?: number;
  @ApiPropertyOptional({ description: '서버 선택 기록 식별자' })
  routeId?: string;

  @ApiPropertyOptional({
    description:
      '도보거리 출처. ROUTED는 출발지, 도착지와 역 사이를 실제 보행로로 구한 값(환승 걷기가 없을 때), ESTIMATED는 환승 시간 환산이나 좌표 우회율 모델, NONE은 걷는 구간 없음',
    enum: ['ROUTED', 'ESTIMATED', 'NONE'],
  })
  walkDistanceSource?: 'ROUTED' | 'ESTIMATED' | 'NONE';

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
    description:
      '경로 중 가장 앞선, 탈 열차가 없는 탑승 구간의 경고와 다음 첫차에 맞춘 출발 시각. 모든 탑승 구간에 열차가 있거나 시간표를 알 수 없으면 없음',
    type: ServiceWarningDto,
  })
  serviceWarning?: ServiceWarningDto;

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

export class RecommendationMetaDto {
  @ApiPropertyOptional({ description: '개인 선호 모델 버전' })
  modelVersion?: string;
  @ApiPropertyOptional({
    description: '선호 산출 출처',
    enum: ['AI', 'SURVEY'],
  })
  preferenceSource?: 'AI' | 'SURVEY';
  @ApiPropertyOptional({
    description: '자료 부족으로 반영하지 못한 설문 코드',
    type: [String],
  })
  unsupportedPreferences?: string[];
  @ApiPropertyOptional({
    description: '서버에서 개인 기준으로 고른 경로 식별자',
  })
  personalRouteId?: string;

  @ApiProperty({
    description:
      '출발 시각의 상황 (WEEKDAY_MORNING_RUSH 등교와 출근, WEEKDAY_MIDDAY 낮 공강, WEEKDAY_EVENING_RUSH 하교와 퇴근, WEEKDAY_NIGHT, LATE_NIGHT, EARLY_MORNING, WEEKEND_DAYTIME, WEEKEND_OTHER)',
    example: 'WEEKDAY_MORNING_RUSH',
  })
  context!: string;

  @ApiProperty({
    description:
      '추천 경로의 가중치를 만든 근거 코드 (PREF_*, PURPOSE_*, CONTEXT_*, HISTORY_*). 앱이 추천 이유 문구를 만든다',
    example: ['PREF_UNCROWDED', 'CONTEXT_RUSH'],
    type: [String],
  })
  reasons!: string[];

  @ApiProperty({
    description: '같은 시간대에 고른 모드 이력이 쓰였는지',
    example: false,
  })
  usedHistory!: boolean;

  @ApiProperty({
    description:
      '최소 비용을 자주 골랐는지. 서버 엔진은 요금을 가중치로 다루지 못해 앱이 후보를 고를 때 요금을 더 본다',
    example: false,
  })
  fareSensitive!: boolean;

  @ApiProperty({
    description: '추천 경로에 적용한 가중치',
    example: { congestion: 2, transferSec: 300 },
  })
  weights!: { congestion: number; transferSec: number };
}

export class RouteSearchResultDto {
  @ApiPropertyOptional({ description: '종합 평가 범위' })
  candidateScope?: string;
  @ApiPropertyOptional({ description: '공통 종합 최적 경로 식별자' })
  commonRouteId?: string;
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

  @ApiPropertyOptional({
    description:
      '로그인한 사용자에게만 포함되는 추천 근거. 비로그인이면 추천(PERSONAL) 후보와 이 필드가 모두 없다',
    type: RecommendationMetaDto,
  })
  recommendation?: RecommendationMetaDto;
}
