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

export type StairSummary = ElevatorSummary;

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

/** 출구나 엘리베이터 문 중 하나라도 있는 역만 담는다. 둘 다 비어 있으면 자료가 없는 역으로 본다 */
export function buildStationFacilities(
  gates: Record<string, GateSummary>,
  elevators: Record<string, ElevatorSummary>,
  stairs: Record<string, StairSummary> = {},
): Record<string, StationFacilities> {
  const result: Record<string, StationFacilities> = {};
  const stationIds = [...new Set([...Object.keys(gates), ...Object.keys(elevators)])].sort();

  for (const stationId of stationIds) {
    const exits = buildExits(gates[stationId]?.gates ?? []);
    const elevatorDoors = [...(elevators[stationId]?.doors ?? [])];
    if (exits.length === 0 && elevatorDoors.length === 0) continue;
    result[stationId] = {
      exits,
      elevatorDoors,
      stairDoors: [...(stairs[stationId]?.doors ?? [])],
    };
  }
  return result;
}
