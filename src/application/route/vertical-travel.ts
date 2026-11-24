import { IStationVerticalRepository } from '../../domain/facility/ports/IStationVerticalRepository';

interface RideLike {
  lineId: string;
  fromStationId: string;
  toStationId: string;
}

/**
 * 승차역(출입구 -> 승강장), 하차역(승강장 -> 출입구), 환승(승강장 -> 승강장)에서 오르내리는 높이(m)의 합.
 * 계단 개수 자료가 없어 계단 축은 이 값으로 근사한다(docs STAIRS_AXIS_DESIGN.md).
 * 한 곳이라도 자료가 없으면 비교할 수 없으므로 undefined
 */
export function verticalTravelOf(
  segments: readonly RideLike[],
  vertical: IStationVerticalRepository,
): number | undefined {
  const rides = segments.filter((segment) => segment.lineId !== 'WALK');
  if (!rides.length) return undefined;
  const boarding = vertical.findStation(rides[0].fromStationId);
  const alighting = vertical.findStation(rides[rides.length - 1].toStationId);
  if (!boarding || !alighting) return undefined;
  let meters = boarding.exitMeters + alighting.exitMeters;
  for (let i = 1; i < rides.length; i++) {
    const from = rides[i - 1].toStationId;
    const to = rides[i].fromStationId;
    // 같은 역 같은 승강장에서 이어 타면(급행에서 일반으로 등) 오르내리지 않는다
    if (from === to) continue;
    const transfer = vertical.findTransfer(from, to);
    if (!transfer) return undefined;
    meters += transfer.meters;
  }
  return Math.round(meters * 100) / 100;
}
