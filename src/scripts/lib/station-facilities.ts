import {
  ExitFacility,
  StationExit,
  StationFacilities,
} from '../../domain/facility/models/station-facilities';
import { KricGateRow } from './kric-convenience';

export interface GateSummary {
  gates: KricGateRow[];
}

export interface ElevatorSummary {
  doors: string[];
}

function exitOrder(a: string, b: string): number {
  const [aMain, aSub = '0'] = a.split('-');
  const [bMain, bSub = '0'] = b.split('-');
  return Number(aMain) - Number(bMain) || Number(aSub) - Number(bSub) || a.localeCompare(b);
}

function clean(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildExits(gates: KricGateRow[]): StationExit[] {
  const byExit = new Map<string, Map<string, ExitFacility>>();
  for (const gate of gates) {
    const exitNo = clean(gate.exitNo);
    const name = clean(gate.impFaclNm);
    if (!exitNo || !name) continue;

    const facilities = byExit.get(exitNo) ?? new Map<string, ExitFacility>();
    byExit.set(exitNo, facilities);
    const address = clean(gate.adr);
    facilities.set(`${name}|${address ?? ''}`, { name, address });
  }

  return [...byExit.keys()]
    .sort(exitOrder)
    .map((exitNo) => ({
      exitNo,
      facilities: [...(byExit.get(exitNo)?.values() ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    }));
}

/** 출구 또는 엘리베이터 자료가 한 번이라도 수집된 역만 담는다 */
export function buildStationFacilities(
  gates: Record<string, GateSummary>,
  elevators: Record<string, ElevatorSummary>,
): Record<string, StationFacilities> {
  const result: Record<string, StationFacilities> = {};
  const stationIds = [...new Set([...Object.keys(gates), ...Object.keys(elevators)])].sort();

  for (const stationId of stationIds) {
    result[stationId] = {
      exits: buildExits(gates[stationId]?.gates ?? []),
      elevatorDoors: [...(elevators[stationId]?.doors ?? [])],
    };
  }
  return result;
}
