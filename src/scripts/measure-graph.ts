import { join } from 'path';
import { GraphData, SubwayGraph } from '../domain/subway/models/subway-graph';
import { OUT_DIR, readJson } from './lib/subway-common';

// Measures the in-memory graph built from the refined data files (stations, edges, transfers).
function buildData(): GraphData {
  return {
    stations: readJson<GraphData['stations']>(join(OUT_DIR, 'stations.json')),
    edges: readJson<GraphData['edges']>(join(OUT_DIR, 'edges.json')),
    transfers: readJson<GraphData['transfers']>(
      join(OUT_DIR, 'transfers.json'),
    ),
  };
}

function heapMb(): number {
  global.gc?.();
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

function main(): void {
  if (!global.gc) throw new Error('run with node --expose-gc');
  const data = buildData();

  const deltas: number[] = [];
  let graph: SubwayGraph | undefined;
  for (let run = 0; run < 5; run += 1) {
    graph = undefined;
    const before = heapMb();
    graph = new SubwayGraph(data);
    deltas.push(heapMb() - before);
  }
  if (!graph) throw new Error('graph was not built');

  const count = graph.stationCount;
  const iterations = 2_000_000;
  let visited = 0;
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) {
    visited += graph.edgesFrom(i % count).length;
  }
  const nsPerLookup = Number(process.hrtime.bigint() - started) / iterations;

  console.log(
    `stations=${count} edges=${data.edges.length} transfers=${data.transfers.length}`,
  );
  console.log(
    `graph heap delta (MB) over 5 builds: ${deltas.map((d) => d.toFixed(2)).join(', ')}`,
  );
  console.log(
    `edgesFrom lookup: ${nsPerLookup.toFixed(1)} ns each (${visited} neighbors visited)`,
  );
}

main();
