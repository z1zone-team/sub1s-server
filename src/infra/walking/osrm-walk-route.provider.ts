import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GeoPoint,
  IWalkRouteProvider,
  WalkLeg,
} from '../../domain/subway/ports/IWalkRouteProvider';

const TIMEOUT_MS = 800;
/** 한 번 실패하면 이 시간 동안은 호출하지 않아, 꺼진 서비스를 기다리느라 검색이 느려지지 않게 한다 */
const COOLDOWN_MS = 30_000;
/** 지점이 가장 가까운 보행로에서 이보다 멀면 그 길로 걷는 경로를 믿지 않는다 */
const MAX_SNAP_M = 500;

interface OsrmResponse {
  code?: string;
  routes?: Array<{ distance?: number; geometry?: string }>;
  waypoints?: Array<{ distance?: number }>;
}

/** OSRM `foot` 프로필로 보행 경로를 구한다. `OSRM_URL`이 없으면 꺼진 것으로 본다 */
@Injectable()
export class OsrmWalkRouteProvider implements IWalkRouteProvider {
  private readonly logger = new Logger(OsrmWalkRouteProvider.name);
  private skipUntil = 0;

  constructor(private readonly config: ConfigService) {}

  async route(from: GeoPoint, to: GeoPoint): Promise<WalkLeg | null> {
    const base = this.config.get<string>('OSRM_URL');
    if (!base || Date.now() < this.skipUntil) return null;

    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `${base.replace(/\/+$/, '')}/route/v1/foot/${coords}?overview=full&geometries=polyline&steps=false&alternatives=false`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`OSRM responded ${res.status}`);
      return this.toLeg((await res.json()) as OsrmResponse);
    } catch (error) {
      this.skipUntil = Date.now() + COOLDOWN_MS;
      this.logger.warn(
        `Walk route unavailable, using estimates for ${COOLDOWN_MS / 1000}s: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private toLeg(body: OsrmResponse): WalkLeg | null {
    // 길을 찾지 못한 것(NoRoute)은 서비스 고장이 아니라서 호출을 멈추지 않고 이번만 추정으로 돌아간다
    if (body.code !== 'Ok') return null;
    const route = body.routes?.[0];
    if (
      !route ||
      typeof route.distance !== 'number' ||
      typeof route.geometry !== 'string'
    )
      return null;

    const snaps = (body.waypoints ?? []).map((point) => point.distance ?? 0);
    if (snaps.some((distance) => distance > MAX_SNAP_M)) return null;

    return {
      distanceM: route.distance + snaps.reduce((sum, d) => sum + d, 0),
      polyline: route.geometry,
    };
  }
}
