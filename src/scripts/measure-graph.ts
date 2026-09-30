import { join } from 'path';
import { GraphData, SubwayGraph } from '../domain/subway/models/subway-graph';
import { OUT_DIR, readJson } from './lib/subway-common';

// Real stations and transfers plus SYNTHETIC route edges (consecutive stations of a line, both directions).
// The synthetic edge count only approximates the real graph until edges.json exists.
interface StationJson {
  id: string;
  lineId: string;
  stationName: string;
  lat: number;
  lng: number;
}

interface TransferJson {
  fromStationId: string;
  toStationId: string;
  walkingDurationSec: number;
}

function buildData(): GraphData {
  const stations = readJson<StationJson[]>(join(OUT_DIR, 'stations.json'));
  const transfers = readJson<TransferJson[]>(join(OUT_DIR, 'transfers.json'));
  const byLine = new Map<string, StationJson[]>();
  for (const station of stations) {
    byLine.set(station.lineId, [
      ...(byLine.get(station.lineId) ?? []),
      station,
    ]);
  }
  const edges: GraphData['edges'] = [];
  for (const [lineId, list] of byLine) {
    for (let i = 1; i < list.length; i += 1) {
      for (const [from, to] of [
        [list[i - 1], list[i]],
        [list[i], list[i - 1]],
      ]) {
        edges.push({
          fromStationId: from.id,
          toStationId: to.id,
          lineId,
          direction: 'DOWN',
          isExpress: false,
          distanceKm: 1.2,
          durationSec: 100,
          isEstimated: true,
        });
      }
    }
  }
  return {
    stations: stations.map((s) => ({ ...s, lineSeq: null })),
    edges,
    transfers,
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
    `stations=${count} edges=${data.edges.length} (synthetic) transfers=${data.transfers.length}`,
  );
  console.log(
    `graph heap delta (MB) over 5 builds: ${deltas.map((d) => d.toFixed(2)).join(', ')}`,
  );
  console.log(
    `edgesFrom lookup: ${nsPerLookup.toFixed(1)} ns each (${visited} neighbors visited)`,
  );
}

main();
