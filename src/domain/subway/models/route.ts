export type RouteMode =
  | 'OPTIMAL'
  | 'COMFORTABLE'
  | 'PERSONAL'
  | 'CHEAPEST'
  | 'ONLY_WALK';

export interface RouteWeights {
  // congestion avoidance weight (wc)
  congestion: number;
  // transfer penalty in seconds (wt)
  transferSec: number;
}

// a section whose edges are unusable in both directions (delay, suspension, incident)
export interface BlockedSegment {
  fromStationId: string;
  toStationId: string;
}

export interface RouteQuery {
  originStationId: string;
  destinationStationId: string;
  mode: RouteMode;
  // required for PERSONAL, ignored for the other modes
  weights?: RouteWeights;
  blockedSegments?: BlockedSegment[];
  // when the trip starts; congestion is looked up at this time plus the time already spent on the route.
  // Defaults to the time of the request.
  departureAt?: Date;
  weekend?: boolean;
}

export interface RouteSegment {
  lineId: string;
  direction: string;
  isExpress: boolean;
  fromStationId: string;
  toStationId: string;
  stationCount: number;
  durationSec: number;
  distanceKm: number;
  isEstimated?: boolean;
}

export interface RouteTransfer {
  fromStationId: string;
  toStationId: string;
  walkingDurationSec: number;
  isEstimated?: boolean;
}

export interface RouteResult {
  mode: RouteMode;
  stationIds: string[];
  segments: RouteSegment[];
  transfers: RouteTransfer[];
  // physical time only: ride time plus walking time, never the weighted search cost
  totalDurationSec: number;
  totalDistanceKm: number;
  transferCount: number;
  totalFare: number;
}

export class RouteNotFoundError extends Error {
  constructor(message = 'no route between the stations') {
    super(message);
    this.name = 'RouteNotFoundError';
  }
}

export class InvalidRouteQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRouteQueryError';
  }
}

export class UnknownStationError extends Error {
  constructor(stationId: string) {
    super(`unknown station id: ${stationId}`);
    this.name = 'UnknownStationError';
  }
}

export const ROUTE_MODE_WEIGHTS: Record<
  Exclude<RouteMode, 'PERSONAL' | 'CHEAPEST' | 'ONLY_WALK'>,
  RouteWeights
> = {
  OPTIMAL: { congestion: 0, transferSec: 180 },
  COMFORTABLE: { congestion: 2, transferSec: 300 },
};
