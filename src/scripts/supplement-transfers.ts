import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  OUT_DIR,
  StationRecord,
  loadStations,
  readJson,
} from './lib/subway-common';
import { TransferRow, supplementTransfers } from './lib/transfers';

// Adds estimated transfers at stations the Seoul Metro data does not cover (other operators).
// run after refine:transfers; it can be run again without adding duplicates.
function main(): void {
  const path = join(OUT_DIR, 'transfers.json');
  const existing = readJson<TransferRow[]>(path);
  const stations = loadStations();
  const byId = new Map<string, StationRecord>(stations.map((s) => [s.id, s]));

  const { transfers, added } = supplementTransfers(stations, existing);
  writeFileSync(path, JSON.stringify(transfers, null, 2) + '\n');

  const estimated = transfers.filter((t) => t.isEstimated).length;
  console.log(
    `existing rows: ${existing.length}, added pairs: ${added.length} (${added.length * 2} rows), total: ${transfers.length}, estimated: ${estimated}`,
  );
  for (const pair of added) {
    const a = byId.get(pair.fromStationId);
    const b = byId.get(pair.toStationId);
    console.log(
      `  ${a?.stationName} ${a?.lineId} <-> ${b?.lineId}: ${pair.distanceM}m, ${pair.walkingDurationSec}s`,
    );
  }
}

main();
