export const CONGESTION_PROVIDER = Symbol('CONGESTION_PROVIDER');

export interface ICongestionProvider {
  // Congestion of riding from one station to the next, 0.0 (empty) to 1.0 (full), at the moment the train
  // leaves fromStation. Arguments are plain values (atEpochMs is a Unix time in milliseconds) because the
  // route search calls this for every edge it relaxes.
  getCongestion(
    lineId: string,
    fromStationId: string,
    toStationId: string,
    direction: string,
    atEpochMs: number,
  ): number;
}

export class NoCongestionProvider implements ICongestionProvider {
  getCongestion(): number {
    return 0;
  }
}
