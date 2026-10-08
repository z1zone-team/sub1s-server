import { distanceKm, normalize } from './subway-common';

export interface TransferRow {
  fromStationId: string;
  toStationId: string;
  walkingDurationSec: number;
  isEstimated?: boolean;
  recommendedDoors?: string[];
  hasStairs?: boolean;
  hasEscalator?: boolean;
}

export interface TransferNode {
  id: string;
  lineId: string;
  stationName: string;
  lat: number;
  lng: number;
}

export interface AddedTransfer {
  fromStationId: string;
  toStationId: string;
  distanceM: number;
  walkingDurationSec: number;
}

// adult walking speed used by Seoul Metro for its transfer times (1.2 m/s)
export const WALKING_SPEED_M_PER_SEC = 1.2;
// coordinates of two lines at one station can be identical, but the walk between platforms is never zero.
// Chosen against the 102 known Seoul Metro transfers: max(distance / 1.2, 60s) has the smallest mean error (45s).
export const MIN_TRANSFER_SEC = 60;
// same name and within this distance means the same physical station. Real interchanges in the data are within
// 460m; 5호선 양평 and 경의중앙선 양평 are 53km apart and 2호선 신촌 and 경의중앙선 신촌 (separate stations) are 715m apart
export const SAME_STATION_MAX_KM = 0.5;

export function physicalKey(name: string): string {
  const base = normalize(name);
  return base.endsWith('역') && base.length > 2 ? base.slice(0, -1) : base;
}

export function estimateWalkingSec(distanceM: number): number {
  return Math.max(
    Math.round(distanceM / WALKING_SPEED_M_PER_SEC),
    MIN_TRANSFER_SEC,
  );
}

function clusters(nodes: TransferNode[]): TransferNode[][] {
  const byName = new Map<string, TransferNode[]>();
  for (const node of nodes) {
    const key = physicalKey(node.stationName);
    byName.set(key, [...(byName.get(key) ?? []), node]);
  }

  const result: TransferNode[][] = [];
  for (const group of byName.values()) {
    const parent = group.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const km = distanceKm(
          group[i].lat,
          group[i].lng,
          group[j].lat,
          group[j].lng,
        );
        if (km <= SAME_STATION_MAX_KM) parent[find(i)] = find(j);
      }
    }
    const roots = new Map<number, TransferNode[]>();
    group.forEach((node, i) => {
      const root = find(i);
      roots.set(root, [...(roots.get(root) ?? []), node]);
    });
    result.push(...roots.values());
  }
  return result;
}

// Adds an estimated, mirrored transfer for every pair of different lines at one physical station
// that has no transfer yet. Existing rows are kept as they are (isEstimated defaults to false).
export function supplementTransfers(
  nodes: TransferNode[],
  existing: TransferRow[],
  stairsMap?: Record<string, { doors?: string[] }>,
): { transfers: TransferRow[]; added: AddedTransfer[] } {
  const rows = existing.map((row) => ({
    ...row,
    isEstimated: row.isEstimated ?? false,
    ...(stairsMap && row.recommendedDoors === undefined
      ? { recommendedDoors: stairsMap[row.fromStationId]?.doors ?? [] }
      : {}),
  }));
  const linked = new Set(
    rows.map((row) => `${row.fromStationId}>${row.toStationId}`),
  );
  const added: AddedTransfer[] = [];

  for (const cluster of clusters(nodes)) {
    for (let i = 0; i < cluster.length; i += 1) {
      for (let j = i + 1; j < cluster.length; j += 1) {
        const a = cluster[i];
        const b = cluster[j];
        if (a.lineId === b.lineId) continue;
        if (linked.has(`${a.id}>${b.id}`) || linked.has(`${b.id}>${a.id}`)) {
          continue;
        }
        const distanceM = distanceKm(a.lat, a.lng, b.lat, b.lng) * 1000;
        const walkingDurationSec = estimateWalkingSec(distanceM);
        const aDoors = stairsMap?.[a.id]?.doors;
        const bDoors = stairsMap?.[b.id]?.doors;
        rows.push(
          {
            fromStationId: a.id,
            toStationId: b.id,
            walkingDurationSec,
            isEstimated: true,
            ...(stairsMap ? { recommendedDoors: aDoors ?? [] } : {}),
          },
          {
            fromStationId: b.id,
            toStationId: a.id,
            walkingDurationSec,
            isEstimated: true,
            ...(stairsMap ? { recommendedDoors: bDoors ?? [] } : {}),
          },
        );
        added.push({
          fromStationId: a.id,
          toStationId: b.id,
          distanceM: Math.round(distanceM),
          walkingDurationSec,
        });
      }
    }
  }

  rows.sort((x, y) =>
    `${x.fromStationId}>${x.toStationId}`.localeCompare(
      `${y.fromStationId}>${y.toStationId}`,
    ),
  );
  return { transfers: rows, added };
}
