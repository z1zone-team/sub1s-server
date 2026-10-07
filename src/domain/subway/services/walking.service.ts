import { Injectable } from '@nestjs/common';
import { StationRecord, SubwayGraph } from '../models/subway-graph';

export interface WalkMetrics {
  straightDistanceKm: number;
  actualDistanceKm: number;
  durationSec: number;
  calories: number;
  steps: number;
}

export interface NearestStationResult {
  station: StationRecord;
  metrics: WalkMetrics;
}

@Injectable()
export class WalkingService {
  /** 성인 평균 보행 속도 1.2 m/s (약 4.32 km/h) - 서울교통공사/국토교통부 기준 */
  readonly WALKING_SPEED_MPS = 1.2;

  /** 도심 실제 도로망 보행 우회율 (직선 거리 대비 약 25% 우회) */
  readonly DETOUR_FACTOR = 1.25;

  /** 체중 65kg 성인 기준 1km당 약 65 kcal 소모 */
  readonly CALORIES_PER_KM = 65;

  /** 1km당 평균 걸음 수 (성인 보폭 약 75cm 기준) */
  readonly STEPS_PER_KM = 1300;

  /**
   * 하버사인 공식(Haversine formula)으로 두 좌표 간의 구면 대원 거리(km)를 계산합니다.
   */
  haversineDistanceKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // 지구 반경 (km)
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * 직선 거리(km)를 기반으로 실제 도보 거리, 소요 시간, 칼로리, 걸음 수를 산출합니다.
   */
  calculateWalkMetrics(straightDistanceKm: number): WalkMetrics {
    const actualDistanceKm =
      Math.round(straightDistanceKm * this.DETOUR_FACTOR * 100) / 100;
    const durationSec = Math.round(
      (actualDistanceKm * 1000) / this.WALKING_SPEED_MPS,
    );
    const calories = Math.round(actualDistanceKm * this.CALORIES_PER_KM);
    const steps = Math.round(actualDistanceKm * this.STEPS_PER_KM);

    return {
      straightDistanceKm: Math.round(straightDistanceKm * 100) / 100,
      actualDistanceKm,
      durationSec,
      calories,
      steps,
    };
  }

  /**
   * 주어진 위경도 좌표에서 반경 maxRadiusKm 내에 위치한 가장 가까운 지하철역 후보를 탐색합니다.
   * 물리적 환승역(동일 역명)은 최단 거리 노드를 우선 채택하여 중복을 방지합니다.
   */
  findNearestStations(
    graph: SubwayGraph,
    lat: number,
    lng: number,
    maxRadiusKm = 2.0,
    limit = 3,
  ): NearestStationResult[] {
    const candidateMap = new Map<string, NearestStationResult>();

    for (let i = 0; i < graph.stationCount; i += 1) {
      const st = graph.station(i);
      const straightDist = this.haversineDistanceKm(lat, lng, st.lat, st.lng);

      if (straightDist <= maxRadiusKm) {
        const metrics = this.calculateWalkMetrics(straightDist);
        const existing = candidateMap.get(st.stationName);

        if (
          !existing ||
          metrics.actualDistanceKm < existing.metrics.actualDistanceKm
        ) {
          candidateMap.set(st.stationName, {
            station: st,
            metrics,
          });
        }
      }
    }

    return Array.from(candidateMap.values())
      .sort((a, b) => a.metrics.actualDistanceKm - b.metrics.actualDistanceKm)
      .slice(0, limit);
  }
}
