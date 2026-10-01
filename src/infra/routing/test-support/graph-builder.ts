import { FareRule } from '../../../domain/subway/fare/fare-calculator';
import {
  GraphData,
  RouteEdgeRecord,
  StationRecord,
  SubwayGraph,
  TransferEdgeRecord,
} from '../../../domain/subway/models/subway-graph';

export const FARE_RULE: FareRule = {
  effectiveFrom: '2026-01-01',
  baseFare: 1550,
  baseDistanceKm: 10,
  tiers: [
    { fromKm: 10, toKm: 50, stepKm: 5, stepFare: 100 },
    { fromKm: 50, stepKm: 8, stepFare: 100 },
  ],
  lineSurcharges: [{ type: 'flat', lineId: 'X', fare: 500 }],
};

// small fixture builder: every ride link is added in both directions unless oneWay is set
export class GraphBuilder {
  private readonly stations: StationRecord[] = [];
  private readonly edges: RouteEdgeRecord[] = [];
  private readonly transfers: TransferEdgeRecord[] = [];

  station(id: string, lineId: string, lat = 37, lng = 127): this {
    this.stations.push({
      id,
      lineId,
      stationName: id,
      lat,
      lng,
      lineSeq: this.stations.length + 1,
    });
    return this;
  }

  ride(
    from: string,
    to: string,
    lineId: string,
    durationSec: number,
    distanceKm = 1,
    options: { oneWay?: boolean; forward?: string; backward?: string } = {},
  ): this {
    const forward = options.forward ?? 'DOWN';
    const backward = options.backward ?? 'UP';
    this.edges.push(
      this.edge(from, to, lineId, durationSec, distanceKm, forward),
    );
    if (!options.oneWay) {
      this.edges.push(
        this.edge(to, from, lineId, durationSec, distanceKm, backward),
      );
    }
    return this;
  }

  transfer(a: string, b: string, walkingDurationSec: number): this {
    this.transfers.push({
      fromStationId: a,
      toStationId: b,
      walkingDurationSec,
    });
    this.transfers.push({
      fromStationId: b,
      toStationId: a,
      walkingDurationSec,
    });
    return this;
  }

  build(): SubwayGraph {
    const data: GraphData = {
      stations: this.stations,
      edges: this.edges,
      transfers: this.transfers,
    };
    return new SubwayGraph(data);
  }

  private edge(
    from: string,
    to: string,
    lineId: string,
    durationSec: number,
    distanceKm: number,
    direction: string,
  ): RouteEdgeRecord {
    return {
      fromStationId: from,
      toStationId: to,
      lineId,
      direction,
      isExpress: false,
      distanceKm,
      durationSec,
      isEstimated: false,
    };
  }
}
