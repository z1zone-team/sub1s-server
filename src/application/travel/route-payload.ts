export interface RideSegment {
  lineId: string;
  distanceKm: number;
  durationSec: number;
  isExpress: boolean;
}

export interface ExpressRun {
  lineId: string;
  fromStationId: string;
  toStationId: string;
}

const WALK_LINE_ID = 'WALK';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// 구간 목록이 없으면 undefined, 도보만 있으면 빈 배열
export function parseRideSegments(payload: unknown): RideSegment[] | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.segments)) return undefined;

  const rides: RideSegment[] = [];
  for (const segment of payload.segments as unknown[]) {
    if (!isRecord(segment)) continue;
    const { lineId, distanceKm, durationSec, isExpress } = segment;
    if (typeof lineId !== 'string' || lineId === WALK_LINE_ID) continue;
    if (!isFiniteNumber(distanceKm) || !isFiniteNumber(durationSec)) continue;
    rides.push({ lineId, distanceKm, durationSec, isExpress: isExpress === true });
  }
  return rides;
}

export function parsePayloadDurationSec(payload: unknown): number | undefined {
  if (isRecord(payload) && isFiniteNumber(payload.durationSec)) {
    return payload.durationSec;
  }
  return undefined;
}

// 급행 구간의 호선과 시작, 도착역. 급행은 중간 역에 서지 않아 경로의 역 목록에 빠진 역이 있다
export function parseExpressRuns(payload: unknown): ExpressRun[] {
  if (!isRecord(payload) || !Array.isArray(payload.segments)) return [];

  const runs: ExpressRun[] = [];
  for (const segment of payload.segments as unknown[]) {
    if (!isRecord(segment) || segment.isExpress !== true) continue;
    const { lineId, fromStationId, toStationId } = segment;
    if (
      typeof lineId === 'string' &&
      typeof fromStationId === 'string' &&
      typeof toStationId === 'string'
    ) {
      runs.push({ lineId, fromStationId, toStationId });
    }
  }
  return runs;
}

// 경로 기록에 저장된 지난 역 ID 목록. 없거나 모양이 맞지 않으면 undefined
export function parseStationIds(payload: unknown): string[] | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.stationIds)) return undefined;
  const ids = payload.stationIds as unknown[];
  return ids.every((id) => typeof id === 'string' && id.length > 0)
    ? (ids as string[])
    : undefined;
}
