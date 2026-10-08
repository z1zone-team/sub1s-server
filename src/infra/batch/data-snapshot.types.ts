export interface StationSnapshotItem {
  id: string;
  name: string;
  lineId: string;
  stationCode: string;
  lat: number;
  lng: number;
}

export interface EdgeSnapshotItem {
  fromStationId: string;
  toStationId: string;
  durationSec: number;
  distanceKm: number;
  isExpress?: boolean;
}

export interface TransferSnapshotItem {
  fromStationId: string;
  toStationId: string;
  durationSec: number;
  isEstimated: boolean;
}

export interface SubwayDataSnapshot {
  version: string;
  createdAt: string;
  contentHash: string;
  summary: {
    stationCount: number;
    edgeCount: number;
    transferCount: number;
    lineCount: number;
  };
  stations: StationSnapshotItem[];
  edges: EdgeSnapshotItem[];
  transfers: TransferSnapshotItem[];
}

export interface StationDiff {
  added: StationSnapshotItem[];
  removed: StationSnapshotItem[];
  renamed: Array<{
    id: string;
    lineId: string;
    oldName: string;
    newName: string;
  }>;
  coordinatesShifted: Array<{
    id: string;
    name: string;
    oldLat: number;
    oldLng: number;
    newLat: number;
    newLng: number;
    distanceMeters: number;
  }>;
}

export interface EdgeDiff {
  added: EdgeSnapshotItem[];
  removed: EdgeSnapshotItem[];
  durationChanged: Array<{
    fromStationId: string;
    toStationId: string;
    oldDurationSec: number;
    newDurationSec: number;
    diffSec: number;
  }>;
}

export interface TransferDiff {
  added: TransferSnapshotItem[];
  removed: TransferSnapshotItem[];
  durationChanged: Array<{
    fromStationId: string;
    toStationId: string;
    oldDurationSec: number;
    newDurationSec: number;
  }>;
}

export interface DataDiffResult {
  hasChanges: boolean;
  baselineHash: string;
  currentHash: string;
  checkedAt: string;
  summary: {
    baselineStations: number;
    currentStations: number;
    baselineEdges: number;
    currentEdges: number;
    baselineTransfers: number;
    currentTransfers: number;
  };
  stationDiff: StationDiff;
  edgeDiff: EdgeDiff;
  transferDiff: TransferDiff;
  unmappedStationNames: string[];
  apiErrors: string[];
}
