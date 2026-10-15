import { RouteMode } from '../../../domain/subway/models/route';
import { SubwayRouteOptionDto } from '../../route/dto/route-search-response.dto';

export interface InterpretedIntentDto {
  originStationName: string;
  destStationName: string;
  preferredMode: RouteMode;
  reason: string;
}

/** 경로를 찾은 결과. `kind`가 없는 응답도 이것이다 */
export interface VoiceRouteRecommendResponseDto {
  kind: 'ROUTE';
  transcript: string;
  interpretedIntent: InterpretedIntentDto;
  recommendedRoute: SubwayRouteOptionDto;
  briefingText: string;
  audioTtsUrl?: string;
}

/** 해석한 출발지. 앱이 후보를 고른 뒤 경로를 검색할 때 그대로 쓴다. 역이면 `stationId`, 현재 위치나 장소면 좌표 */
export interface VoiceOriginDto {
  name: string;
  stationId?: string;
  lat?: number;
  lng?: number;
}

export interface VoiceDestinationCandidateNearestStationDto {
  stationId: string;
  name: string;
  walkDistanceM: number;
  walkDurationSec: number;
}

/** 도착지로 말한 이름의 후보. 역(`STATION`)이면 `stationId`, 장소(`PLACE`)면 가장 가까운 역과 도보 시간을 가진다 */
export interface VoiceDestinationCandidateDto {
  type: 'STATION' | 'PLACE';
  name: string;
  address?: string;
  category?: string;
  lat: number;
  lng: number;
  stationId?: string;
  nearestStation?: VoiceDestinationCandidateNearestStationDto;
}

/**
 * 도착지 후보가 여러 개여서 사용자에게 "이 곳이 맞나요?"를 물어야 하는 결과.
 * 경로는 계산하지 않았고, 앱이 후보를 고르면 `origin`과 고른 후보로 경로를 검색한다
 */
export interface VoiceDestinationConfirmDto {
  kind: 'CONFIRM_DESTINATION';
  transcript: string;
  interpretedIntent: InterpretedIntentDto;
  origin: VoiceOriginDto;
  candidates: VoiceDestinationCandidateDto[];
}

/** 음성 작업의 결과. 작업 조회와 WebSocket `voice_result`가 같은 형태를 쓴다 */
export type VoiceResultDto =
  VoiceRouteRecommendResponseDto | VoiceDestinationConfirmDto;
