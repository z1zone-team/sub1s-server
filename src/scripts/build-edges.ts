import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { LinePath, Segment, buildEdges, calibrate } from './lib/edges';
import { OUT_DIR, loadStations, readJson } from './lib/subway-common';
import { TopologyLink } from './build-topology';

interface Topology {
  links: TopologyLink[];
}

// Line 2 loop links follow the KRIC order 시청 -> 충정로, which is the 외선순환 (OUTER).
// The branch stations below hang on the loop and use plain DOWN/UP.
const LOOP_LINES = new Set(['02']);
const BRANCH_STATION_NAMES: Record<string, string[]> = {
  '02': [
    '용답',
    '신답',
    '용두',
    '신설동',
    '도림천',
    '양천구청',
    '신정네거리',
    '까치산',
  ],
};

function main(): void {
  const stations = loadStations();
  const nameOf = new Map(stations.map((s) => [s.id, s.stationName]));
  const segments = readJson<Segment[]>(join(OUT_DIR, 'segments.json'));
  const topology = readJson<Topology>(join(OUT_DIR, 'line-topology.json'));
  const calibration = calibrate(segments, stations);

  const paths: LinePath[] = topology.links.map((link) => {
    const branch = BRANCH_STATION_NAMES[link.lineId] ?? [];
    const onBranch = [link.fromStationId, link.toStationId].some((id) =>
      branch.includes(nameOf.get(id) ?? ''),
    );
    const isLoopLink = LOOP_LINES.has(link.lineId) && !onBranch;
    return {
      lineId: link.lineId,
      stationIds: [link.fromStationId, link.toStationId],
      labels: isLoopLink
        ? { forward: 'OUTER', backward: 'INNER' }
        : { forward: 'DOWN', backward: 'UP' },
    };
  });

  const edges = buildEdges(paths, segments, stations, calibration);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, 'edges.json'),
    JSON.stringify(edges, null, 2) + String.fromCharCode(10),
  );

  const estimated = edges.filter((e) => e.isEstimated).length;
  const directions = new Map<string, number>();
  for (const e of edges) {
    directions.set(e.direction, (directions.get(e.direction) ?? 0) + 1);
  }
  console.log(
    `edges: ${edges.length} (measured ${edges.length - estimated}, estimated ${estimated}), links: ${topology.links.length}`,
  );
  console.log(
    `calibration: circuity ${calibration.circuity.toFixed(3)}, speed ${calibration.speedKmh.toFixed(1)}km/h`,
  );
  console.log(
    `directions: ${[...directions].map(([d, n]) => `${d}=${n}`).join(' ')}`,
  );
}

main();
