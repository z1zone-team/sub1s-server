export interface StationRecord {
  id: string;
  lineId: string;
  stationName: string;
  lat: number;
  lng: number;
  lineSeq: number | null;
}

export interface RouteEdgeRecord {
  fromStationId: string;
  toStationId: string;
  lineId: string;
  direction: string;
  isExpress: boolean;
  distanceKm: number;
  durationSec: number;
  isEstimated: boolean;
}

export interface TransferEdgeRecord {
  fromStationId: string;
  toStationId: string;
  walkingDurationSec: number;
  isEstimated?: boolean;
  recommendedDoors?: string[];
}

export interface GraphData {
  stations: StationRecord[];
  edges: RouteEdgeRecord[];
  transfers: TransferEdgeRecord[];
}

export interface GraphEdge {
  readonly toIndex: number;
  readonly lineId: string;
  readonly direction: string;
  readonly isExpress: boolean;
  readonly distanceKm: number;
  readonly durationSec: number;
  readonly isEstimated: boolean;
}

export interface GraphTransfer {
  readonly toIndex: number;
  readonly walkingDurationSec: number;
  readonly isEstimated: boolean;
  readonly recommendedDoors?: readonly string[];
}

// Immutable adjacency list. Stations are addressed by a dense index, so neighbor lookup is an array access.
export class SubwayGraph {
  readonly stationCount: number;
  private readonly indexById = new Map<string, number>();
  private readonly stations: readonly StationRecord[];
  private readonly edgesByStation: readonly (readonly GraphEdge[])[];
  private readonly transfersByStation: readonly (readonly GraphTransfer[])[];

  constructor(data: GraphData) {
    this.stations = Object.freeze(
      data.stations.map((s) => Object.freeze({ ...s })),
    );
    this.stationCount = this.stations.length;
    this.stations.forEach((station, index) => {
      if (this.indexById.has(station.id))
        throw new Error(`duplicate station id: ${station.id}`);
      this.indexById.set(station.id, index);
    });

    const edges: GraphEdge[][] = this.stations.map(() => []);
    for (const edge of data.edges) {
      const from = this.requireIndex(edge.fromStationId);
      edges[from].push(
        Object.freeze({
          toIndex: this.requireIndex(edge.toStationId),
          lineId: edge.lineId,
          direction: edge.direction,
          isExpress: edge.isExpress,
          distanceKm: edge.distanceKm,
          durationSec: edge.durationSec,
          isEstimated: edge.isEstimated,
        }),
      );
    }

    const transfers: GraphTransfer[][] = this.stations.map(() => []);
    for (const transfer of data.transfers) {
      const from = this.requireIndex(transfer.fromStationId);
      transfers[from].push(
        Object.freeze({
          toIndex: this.requireIndex(transfer.toStationId),
          walkingDurationSec: transfer.walkingDurationSec,
          isEstimated: transfer.isEstimated ?? false,
          ...(transfer.recommendedDoors
            ? {
                recommendedDoors: Object.freeze([...transfer.recommendedDoors]),
              }
            : {}),
        }),
      );
    }

    this.edgesByStation = Object.freeze(
      edges.map((list) => Object.freeze(list)),
    );
    this.transfersByStation = Object.freeze(
      transfers.map((list) => Object.freeze(list)),
    );
  }

  indexOf(stationId: string): number | undefined {
    return this.indexById.get(stationId);
  }

  station(index: number): StationRecord {
    return this.stations[index];
  }

  edgesFrom(index: number): readonly GraphEdge[] {
    return this.edgesByStation[index];
  }

  transfersFrom(index: number): readonly GraphTransfer[] {
    return this.transfersByStation[index];
  }

  private requireIndex(stationId: string): number {
    const index = this.indexById.get(stationId);
    if (index === undefined)
      throw new Error(`unknown station id in graph data: ${stationId}`);
    return index;
  }
}
