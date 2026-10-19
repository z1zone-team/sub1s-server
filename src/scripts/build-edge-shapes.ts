import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { OsmRailwaysFile } from './lib/osm-railways';
import { OUT_DIR, RAW_DIR, StationRecord, loadStations, readJson } from './lib/subway-common';
import { encodePolyline } from '../common/utils/polyline';
import { buildTrackGraph, trackShape } from './lib/track-shapes';

/**
 * 역 사이 구간(간선)마다 실제 선로를 따라가는 좌표열을 만들어 edge-shapes.json에 저장한다.
 *   pnpm fetch:osm-railways && pnpm build:edge-shapes
 * 키는 정렬한 역 ID 쌍("A|B", A < B)이고 값은 A에서 B로 가는 인코딩 폴리라인(정밀도 5)이다.
 * 선로를 찾지 못하거나 직선 거리와 너무 다른 구간은 넣지 않으며 앱은 그 구간을 직선으로 그린다.
 * 원본은 OpenStreetMap이고 ODbL이라 출처 표시(© OpenStreetMap contributors)가 필요하다
 */
interface EdgeRow {
  fromStationId: string;
  toStationId: string;
  lineId: string;
}

function main(): void {
  const rawPath = join(RAW_DIR, 'osm-railways.json');
  if (!existsSync(rawPath)) throw new Error('osm-railways.json not found. Run pnpm fetch:osm-railways first.');
  const graph = buildTrackGraph(readJson<OsmRailwaysFile>(rawPath).ways);
  const stations = new Map<string, StationRecord>(loadStations().map((s) => [s.id, s]));
  const edges = readJson<EdgeRow[]>(join(OUT_DIR, 'edges.json'));

  const pairs = new Map<string, { a: string; b: string; lineId: string }>();
  for (const edge of edges) {
    const [a, b] = [edge.fromStationId, edge.toStationId].sort();
    pairs.set(`${a}|${b}`, { a, b, lineId: edge.lineId });
  }

  const shapes: Record<string, string> = {};
  const failed: Record<string, string[]> = {};
  const total: Record<string, number> = {};
  for (const [key, { a, b, lineId }] of [...pairs.entries()].sort(([x], [y]) => x.localeCompare(y))) {
    total[lineId] = (total[lineId] ?? 0) + 1;
    const from = stations.get(a);
    const to = stations.get(b);
    const shape =
      from && to ? trackShape(graph, { lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }) : undefined;
    if (shape) shapes[key] = encodePolyline(shape);
    else (failed[lineId] ??= []).push(`${from?.stationName ?? a}-${to?.stationName ?? b}`);
  }

  writeFileSync(join(OUT_DIR, 'edge-shapes.json'), JSON.stringify(shapes) + '\n', 'utf-8');
  const ok = Object.keys(shapes).length;
  console.log(`[Edge Shapes] ${ok}/${pairs.size} pairs have a track shape`);
  for (const lineId of Object.keys(total).sort()) {
    const fails = failed[lineId] ?? [];
    console.log(`  ${lineId}: ${total[lineId] - fails.length}/${total[lineId]}${fails.length ? ` failed: ${fails.join(', ')}` : ''}`);
  }
}

main();
