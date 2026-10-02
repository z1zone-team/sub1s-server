export const CONGESTION_PROVIDER = Symbol('CONGESTION_PROVIDER');

export interface ICongestionProvider {
  // congestion of riding from one station to the next on a line, 0.0 (empty) to 1.0 (full)
  getCongestion(
    lineId: string,
    fromStationId: string,
    toStationId: string,
  ): number;
}

export class NoCongestionProvider implements ICongestionProvider {
  getCongestion(): number {
    return 0;
  }
}
