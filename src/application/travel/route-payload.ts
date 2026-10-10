export interface RideSegment {
  lineId: string;
  distanceKm: number;
  durationSec: number;
  isExpress: boolean;
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
