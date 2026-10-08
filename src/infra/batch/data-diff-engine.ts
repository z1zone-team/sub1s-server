import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  DataDiffResult,
  EdgeDiff,
  EdgeSnapshotItem,
  StationDiff,
  StationSnapshotItem,
  SubwayDataSnapshot,
  TransferDiff,
  TransferSnapshotItem,
} from './data-snapshot.types';
import {
  DATASET_NAME_ALIASES,
  distanceKm,
  EQUIVALENT_NAMES,
  KRIC_NAME_ALIASES,
  normalize,
} from '../../scripts/lib/subway-common';

export class DataDiffEngine {
  private static readonly DEFAULT_SUBWAY_DIR = join(
    __dirname,
    '../../data/subway',
  );

  /**
   * Deterministic SHA-256 hash of canonical stations, edges, and transfers.
   */
  public static computeSnapshotHash(
    stations: StationSnapshotItem[],
    edges: EdgeSnapshotItem[],
    transfers: TransferSnapshotItem[],
  ): string {
    const sortedStations = [...stations]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        lineId: s.lineId,
        stationCode: s.stationCode,
        lat: Number(s.lat.toFixed(6)),
        lng: Number(s.lng.toFixed(6)),
      }));

    const sortedEdges = [...edges]
      .sort((a, b) =>
        `${a.fromStationId}->${a.toStationId}`.localeCompare(
          `${b.fromStationId}->${b.toStationId}`,
        ),
      )
      .map((e) => ({
        from: e.fromStationId,
        to: e.toStationId,
        duration: e.durationSec,
        distance: Number(e.distanceKm.toFixed(2)),
        isExpress: !!e.isExpress,
      }));

    const sortedTransfers = [...transfers]
      .sort((a, b) =>
        `${a.fromStationId}->${a.toStationId}`.localeCompare(
          `${b.fromStationId}->${b.toStationId}`,
        ),
      )
      .map((t) => ({
        from: t.fromStationId,
        to: t.toStationId,
        duration: t.durationSec,
        isEstimated: !!t.isEstimated,
      }));

    const payload = JSON.stringify({
      stations: sortedStations,
      edges: sortedEdges,
      transfers: sortedTransfers,
    });

    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Create a standardized SubwayDataSnapshot from station, edge, transfer arrays.
   */
  public static createSnapshot(
    stations: StationSnapshotItem[],
    edges: EdgeSnapshotItem[],
    transfers: TransferSnapshotItem[],
    version = '1.0.0',
    createdAt = new Date().toISOString(),
  ): SubwayDataSnapshot {
    const lines = new Set(stations.map((s) => s.lineId));
    const contentHash = this.computeSnapshotHash(stations, edges, transfers);

    return {
      version,
      createdAt,
      contentHash,
      summary: {
        stationCount: stations.length,
        edgeCount: edges.length,
        transferCount: transfers.length,
        lineCount: lines.size,
      },
      stations,
      edges,
      transfers,
    };
  }

  /**
   * Loads baseline snapshot from disk.
   * If baseline-snapshot.json exists, reads it; otherwise constructs one from active stations.json, edges.json, transfers.json.
   */
  public static loadBaselineSnapshot(
    subwayDir = this.DEFAULT_SUBWAY_DIR,
  ): SubwayDataSnapshot {
    const baselineFile = join(subwayDir, 'baseline-snapshot.json');
    if (existsSync(baselineFile)) {
      try {
        return JSON.parse(
          readFileSync(baselineFile, 'utf-8'),
        ) as SubwayDataSnapshot;
      } catch {
        // Fall back to building from json files
      }
    }

    const stationsRaw = JSON.parse(
      readFileSync(join(subwayDir, 'stations.json'), 'utf-8'),
    ) as Array<{
      id: string;
      stationName: string;
      lineId: string;
      stationCode: string;
      lat: number;
      lng: number;
    }>;

    const edgesRaw = JSON.parse(
      readFileSync(join(subwayDir, 'edges.json'), 'utf-8'),
    ) as Array<{
      fromStationId: string;
      toStationId: string;
      durationSec: number;
      distanceKm: number;
      isExpress?: boolean;
    }>;

    const transfersRaw = JSON.parse(
      readFileSync(join(subwayDir, 'transfers.json'), 'utf-8'),
    ) as Array<{
      fromStationId: string;
      toStationId: string;
      durationSec: number;
      isEstimated: boolean;
    }>;

    const stations: StationSnapshotItem[] = stationsRaw.map((s) => ({
      id: s.id,
      name: s.stationName,
      lineId: s.lineId,
      stationCode: s.stationCode,
      lat: s.lat,
      lng: s.lng,
    }));

    const edges: EdgeSnapshotItem[] = edgesRaw.map((e) => ({
      fromStationId: e.fromStationId,
      toStationId: e.toStationId,
      durationSec: e.durationSec,
      distanceKm: e.distanceKm,
      isExpress: e.isExpress,
    }));

    const transfers: TransferSnapshotItem[] = transfersRaw.map((t) => ({
      fromStationId: t.fromStationId,
      toStationId: t.toStationId,
      durationSec: t.durationSec,
      isEstimated: t.isEstimated,
    }));

    return this.createSnapshot(stations, edges, transfers);
  }

  /**
   * Compares two snapshots and produces a structured DataDiffResult.
   */
  public static compareSnapshots(
    baseline: SubwayDataSnapshot,
    current: SubwayDataSnapshot,
    options: {
      coordinateThresholdMeters?: number;
      durationThresholdSec?: number;
      apiErrors?: string[];
    } = {},
  ): DataDiffResult {
    const coordinateThresholdMeters = options.coordinateThresholdMeters ?? 50;
    const durationThresholdSec = options.durationThresholdSec ?? 10;
    const apiErrors = options.apiErrors ?? [];

    // 1. Station Diff
    const baselineStationMap = new Map(baseline.stations.map((s) => [s.id, s]));
    const currentStationMap = new Map(current.stations.map((s) => [s.id, s]));

    const stationDiff: StationDiff = {
      added: [],
      removed: [],
      renamed: [],
      coordinatesShifted: [],
    };

    for (const curr of current.stations) {
      const base = baselineStationMap.get(curr.id);
      if (!base) {
        stationDiff.added.push(curr);
      } else {
        if (curr.name !== base.name) {
          stationDiff.renamed.push({
            id: curr.id,
            lineId: curr.lineId,
            oldName: base.name,
            newName: curr.name,
          });
        }
        const distMeters =
          distanceKm(base.lat, base.lng, curr.lat, curr.lng) * 1000;
        if (distMeters >= coordinateThresholdMeters) {
          stationDiff.coordinatesShifted.push({
            id: curr.id,
            name: curr.name,
            oldLat: base.lat,
            oldLng: base.lng,
            newLat: curr.lat,
            newLng: curr.lng,
            distanceMeters: Math.round(distMeters),
          });
        }
      }
    }

    for (const base of baseline.stations) {
      if (!currentStationMap.has(base.id)) {
        stationDiff.removed.push(base);
      }
    }

    // 2. Edge Diff
    const edgeKey = (e: { fromStationId: string; toStationId: string }): string =>
      `${e.fromStationId}->${e.toStationId}`;
    const baselineEdgeMap = new Map(
      baseline.edges.map((e) => [edgeKey(e), e]),
    );
    const currentEdgeMap = new Map(current.edges.map((e) => [edgeKey(e), e]));

    const edgeDiff: EdgeDiff = {
      added: [],
      removed: [],
      durationChanged: [],
    };

    for (const curr of current.edges) {
      const base = baselineEdgeMap.get(edgeKey(curr));
      if (!base) {
        edgeDiff.added.push(curr);
      } else {
        const diffSec = Math.abs(curr.durationSec - base.durationSec);
        if (diffSec >= durationThresholdSec) {
          edgeDiff.durationChanged.push({
            fromStationId: curr.fromStationId,
            toStationId: curr.toStationId,
            oldDurationSec: base.durationSec,
            newDurationSec: curr.durationSec,
            diffSec: curr.durationSec - base.durationSec,
          });
        }
      }
    }

    for (const base of baseline.edges) {
      if (!currentEdgeMap.has(edgeKey(base))) {
        edgeDiff.removed.push(base);
      }
    }

    // 3. Transfer Diff
    const transferKey = (t: {
      fromStationId: string;
      toStationId: string;
    }): string => `${t.fromStationId}->${t.toStationId}`;
    const baselineTransferMap = new Map(
      baseline.transfers.map((t) => [transferKey(t), t]),
    );
    const currentTransferMap = new Map(
      current.transfers.map((t) => [transferKey(t), t]),
    );

    const transferDiff: TransferDiff = {
      added: [],
      removed: [],
      durationChanged: [],
    };

    for (const curr of current.transfers) {
      const base = baselineTransferMap.get(transferKey(curr));
      if (!base) {
        transferDiff.added.push(curr);
      } else {
        if (Math.abs(curr.durationSec - base.durationSec) >= durationThresholdSec) {
          transferDiff.durationChanged.push({
            fromStationId: curr.fromStationId,
            toStationId: curr.toStationId,
            oldDurationSec: base.durationSec,
            newDurationSec: curr.durationSec,
          });
        }
      }
    }

    for (const base of baseline.transfers) {
      if (!currentTransferMap.has(transferKey(base))) {
        transferDiff.removed.push(base);
      }
    }

    // 4. Detect Unmapped / Unknown station names
    const knownNames = new Set<string>();
    for (const s of baseline.stations) {
      knownNames.add(normalize(s.name));
    }
    for (const alias of Object.values(DATASET_NAME_ALIASES)) {
      knownNames.add(normalize(alias));
    }
    for (const alias of Object.values(KRIC_NAME_ALIASES)) {
      knownNames.add(normalize(alias));
    }
    for (const group of EQUIVALENT_NAMES) {
      for (const eq of group) {
        knownNames.add(normalize(eq));
      }
    }

    const unmappedStationNames: string[] = [];
    for (const s of current.stations) {
      const norm = normalize(s.name);
      if (!knownNames.has(norm)) {
        unmappedStationNames.push(s.name);
      }
    }

    const hasChanges =
      baseline.contentHash !== current.contentHash ||
      stationDiff.added.length > 0 ||
      stationDiff.removed.length > 0 ||
      stationDiff.renamed.length > 0 ||
      stationDiff.coordinatesShifted.length > 0 ||
      edgeDiff.added.length > 0 ||
      edgeDiff.removed.length > 0 ||
      edgeDiff.durationChanged.length > 0 ||
      transferDiff.added.length > 0 ||
      transferDiff.removed.length > 0 ||
      transferDiff.durationChanged.length > 0 ||
      unmappedStationNames.length > 0;

    return {
      hasChanges,
      baselineHash: baseline.contentHash,
      currentHash: current.contentHash,
      checkedAt: new Date().toISOString(),
      summary: {
        baselineStations: baseline.summary.stationCount,
        currentStations: current.summary.stationCount,
        baselineEdges: baseline.summary.edgeCount,
        currentEdges: current.summary.edgeCount,
        baselineTransfers: baseline.summary.transferCount,
        currentTransfers: current.summary.transferCount,
      },
      stationDiff,
      edgeDiff,
      transferDiff,
      unmappedStationNames,
      apiErrors,
    };
  }
}
