import { copyFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildKricStationMap } from './lib/kric-convenience';
import { InterStationDuration } from './lib/kric-timetable';
import { OUT_DIR, RAW_DIR, StationRecord, readJson } from './lib/subway-common';

interface FullStationRecord extends StationRecord {
  lineSeq?: number | null;
}

interface EdgeJson {
  fromStationId: string;
  toStationId: string;
  lineId: string;
  direction: string;
  isExpress: boolean;
  distanceKm: number;
  durationSec: number;
  isEstimated: boolean;
}

function calculateDistanceBetween(
  edges: EdgeJson[],
  fromId: string,
  toId: string,
): number {
  // Direct edge if already exists
  const direct = edges.find(
    (e) => e.fromStationId === fromId && e.toStationId === toId && !e.isExpress,
  );
  if (direct) return direct.distanceKm;

  // Simple BFS / Dijkstra on the same line to sum regular distances
  const lineId = fromId.split('_')[0];
  const queue: Array<{ curr: string; dist: number }> = [
    { curr: fromId, dist: 0 },
  ];
  const visited = new Set<string>([fromId]);

  while (queue.length > 0) {
    const { curr, dist } = queue.shift()!;
    if (curr === toId) return Number(dist.toFixed(2));

    const neighbors = edges.filter(
      (e) =>
        e.fromStationId === curr &&
        e.lineId === lineId &&
        !e.isExpress &&
        !visited.has(e.toStationId),
    );

    for (const n of neighbors) {
      visited.add(n.toStationId);
      queue.push({ curr: n.toStationId, dist: dist + n.distanceKm });
    }
  }

  return 0;
}

function main(): void {
  const edgesPath = join(OUT_DIR, 'edges.json');
  const edges = readJson<EdgeJson[]>(edgesPath);
  const stations = readJson<FullStationRecord[]>(
    join(OUT_DIR, 'stations.json'),
  );
  const stationMap = buildKricStationMap(stations, RAW_DIR);

  const durationsPath = join(RAW_DIR, 'kric-durations.json');
  if (!existsSync(durationsPath)) {
    throw new Error(
      `Durations file not found: ${durationsPath}. Run pnpm fetch:kric-timetables first.`,
    );
  }
  const durations = readJson<InterStationDuration[]>(durationsPath);

  // Map: `${fromStinCd}->${toStinCd}` -> durationSec
  const regularDurMap = new Map<string, number>();
  const expressDurMap = new Map<string, number>();

  for (const d of durations) {
    const key = `${d.fromStinCd}->${d.toStinCd}`;
    if (d.isExpress) {
      expressDurMap.set(key, d.durationSec);
    } else {
      regularDurMap.set(key, d.durationSec);
    }
  }

  // 역 KRIC stinCd 역매핑
  const stinToStationId = new Map<string, string>();
  for (const [sId, kric] of stationMap.entries()) {
    stinToStationId.set(kric.stinCd, sId);
  }

  let regularUpdatedCount = 0;
  let estimatedResolvedCount = 0;

  // 1. 기존 일반 간선 소요시간 갱신 및 추정 플래그 해제
  const updatedEdges: EdgeJson[] = edges.map((edge) => {
    if (edge.isExpress) return edge;

    const fromKric = stationMap.get(edge.fromStationId);
    const toKric = stationMap.get(edge.toStationId);

    if (fromKric && toKric) {
      const key = `${fromKric.stinCd}->${toKric.stinCd}`;
      const timetableDuration = regularDurMap.get(key);

      if (timetableDuration !== undefined && timetableDuration > 0) {
        regularUpdatedCount += 1;
        if (edge.isEstimated) {
          estimatedResolvedCount += 1;
        }
        return {
          ...edge,
          durationSec: timetableDuration,
          isEstimated: false,
        };
      }
    }

    // 시간표 매칭 안 된 경우 (서울교통공사 실측 지선 등) 기존 값 유지하되 이미 실측이면 그대로
    return edge;
  });

  // 2. 급행 간선 추가 (Line 9 등 KRIC에서 급행 패턴이 확인된 간선)
  let expressAddedCount = 0;
  const existingKeys = new Set(
    updatedEdges.map(
      (e) => `${e.fromStationId}->${e.toStationId}:${e.isExpress}`,
    ),
  );

  for (const d of durations) {
    if (!d.isExpress) continue;

    // Line 9 급행만 우선 선별 반영 (노선 단절 없는 완결된 급행망 보장)
    const fromId = stinToStationId.get(d.fromStinCd);
    const toId = stinToStationId.get(d.toStinCd);
    if (!fromId || !toId) continue;

    const fromStation = stations.find((s) => s.id === fromId);
    const toStation = stations.find((s) => s.id === toId);
    if (!fromStation || !toStation) continue;
    if (fromStation.lineId !== toStation.lineId) continue;

    // 9호선 급행 대상
    if (fromStation.lineId !== '09') continue;

    const edgeKey = `${fromId}->${toId}:true`;
    if (existingKeys.has(edgeKey)) continue;

    // 방향 결정 (lineSeq 기준)
    let direction = 'UP';
    if (
      typeof fromStation.lineSeq === 'number' &&
      typeof toStation.lineSeq === 'number'
    ) {
      direction = fromStation.lineSeq < toStation.lineSeq ? 'DOWN' : 'UP';
    }

    const distanceKm = calculateDistanceBetween(edges, fromId, toId);
    if (distanceKm <= 0) continue;

    updatedEdges.push({
      fromStationId: fromId,
      toStationId: toId,
      lineId: fromStation.lineId,
      direction,
      isExpress: true,
      distanceKm,
      durationSec: d.durationSec,
      isEstimated: false,
    });

    existingKeys.add(edgeKey);
    expressAddedCount += 1;
  }

  // 3. 파일 저장
  writeFileSync(edgesPath, JSON.stringify(updatedEdges, null, 2), 'utf-8');
  console.log(`[Refine Edges] Updated edges saved to ${edgesPath}`);

  const distEdgesPath = join(__dirname, '../../dist/data/subway/edges.json');
  if (existsSync(join(__dirname, '../../dist/data/subway'))) {
    copyFileSync(edgesPath, distEdgesPath);
    console.log(`[Refine Edges] Synced to ${distEdgesPath}`);
  }

  const remainingEstimated = updatedEdges.filter((e) => e.isEstimated).length;
  console.log(`====================================================`);
  console.log(`[Refine Edges Summary]`);
  console.log(`- Total edges: ${updatedEdges.length}`);
  console.log(`- Regular edges updated with timetable: ${regularUpdatedCount}`);
  console.log(`- Estimated edges resolved: ${estimatedResolvedCount}`);
  console.log(`- Express edges added: ${expressAddedCount}`);
  console.log(`- Remaining estimated edges: ${remainingEstimated}`);
  console.log(`====================================================`);
}

main();
