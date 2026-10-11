import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { StationFacilitiesFile } from '../domain/facility/models/station-facilities';
import {
  ElevatorSummary,
  GateSummary,
  buildStationFacilities,
} from './lib/station-facilities';
import { OUT_DIR, RAW_DIR, readJson } from './lib/subway-common';

function load<T>(fileName: string): Record<string, T> {
  const path = join(RAW_DIR, fileName);
  if (!existsSync(path)) {
    throw new Error(`${fileName} not found. Run pnpm fetch:kric-convenience first.`);
  }
  return readJson<Record<string, T>>(path);
}

// 한 역을 한 줄로 써서 갱신할 때 diff가 역 단위로 보이게 한다
function serialize(file: StationFacilitiesFile): string {
  const lines = Object.entries(file.stations).map(
    ([stationId, value]) => `  ${JSON.stringify(stationId)}:${JSON.stringify(value)}`,
  );
  return `{"stations":{\n${lines.join(',\n')}\n}}\n`;
}

function main(): void {
  const stations = buildStationFacilities(
    load<GateSummary>('kric-gates.json'),
    load<ElevatorSummary>('kric-elevators.json'),
  );

  const values = Object.values(stations);
  console.log(
    `[Facilities] ${values.length} stations, ${values.filter((s) => s.exits.length > 0).length} with exits, ${values.filter((s) => s.elevatorDoors.length > 0).length} with elevator doors`,
  );

  const outPath = join(OUT_DIR, 'station-facilities.json');
  writeFileSync(outPath, serialize({ stations }), 'utf-8');
  console.log(`[Facilities] Saved ${outPath}`);
}

main();
