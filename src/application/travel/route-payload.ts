// Reads the route segments saved (encrypted) with a travel log. Walking segments are not rides.
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

// undefined when the payload has no segment list at all; an empty array when it only had walking.
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

// A duration stored directly on the payload, if any.
export function parsePayloadDurationSec(payload: unknown): number | undefined {
  if (isRecord(payload) && isFiniteNumber(payload.durationSec)) {
    return payload.durationSec;
  }
  return undefined;
}
