import { TrackedRoute } from '../models/tracking-session';
import { planSmartAlerts } from './smart-alert-planner';

describe('planSmartAlerts', () => {
  // 2호선 A, B, C 다음 X(2호선) -> X(3호선) 환승 뒤 3호선 Y, Z에서 하차
  const stationIds = ['02_A', '02_B', '02_C', '02_X', '03_X', '03_Y', '03_Z'];
  const transferRoute: TrackedRoute = {
    mode: 'OPTIMAL',
    totalDurationSec: 900,
    segments: [
      {
        lineId: '02',
        fromStationId: '02_A',
        toStationId: '02_X',
        recommendedDoors: ['2-1', '4-4'],
      },
      { lineId: 'WALK', fromStationId: '02_X', toStationId: '03_X' },
      {
        lineId: '03',
        fromStationId: '03_X',
        toStationId: '03_Z',
        recommendedDoors: ['1-2'],
      },
    ],
  };
  const directRoute: TrackedRoute = {
    mode: 'OPTIMAL',
    totalDurationSec: 600,
    segments: [{ lineId: '02', fromStationId: '02_A', toStationId: '02_C' }],
  };

  const plan = (
    route: TrackedRoute,
    ids: string[],
    currentStationId: string,
    sentAlertKeys?: string[],
  ) =>
    planSmartAlerts({
      allStationIds: ids,
      currentStationId,
      routeOption: route,
      sentAlertKeys,
    });

  it('warns one station before a transfer with the recommended door', () => {
    expect(plan(transferRoute, stationIds, '02_C')).toEqual([
      { key: 'TRANSFER_PREPARE:0', type: 'TRANSFER_PREPARE', stationId: '02_X', door: '2-1' },
    ]);
  });

  it('says to transfer now on arriving at the transfer station', () => {
    expect(plan(transferRoute, stationIds, '02_X')).toEqual([
      { key: 'TRANSFER_NOW:0', type: 'TRANSFER_NOW', stationId: '02_X', door: '2-1' },
    ]);
  });

  it('also says to transfer now when the position is already the other line node of the transfer station', () => {
    expect(plan(transferRoute, stationIds, '03_X').map((a) => a.type)).toEqual(['TRANSFER_NOW']);
  });

  it('warns one station before getting off on the last ride', () => {
    expect(plan(transferRoute, stationIds, '03_Y')).toEqual([
      { key: 'ALIGHT_PREPARE:2', type: 'ALIGHT_PREPARE', stationId: '03_Z', door: '1-2' },
    ]);
  });

  it('warns before getting off on a route without transfers and leaves the door empty when unknown', () => {
    expect(plan(directRoute, ['02_A', '02_B', '02_C'], '02_B')).toEqual([
      { key: 'ALIGHT_PREPARE:0', type: 'ALIGHT_PREPARE', stationId: '02_C', door: '' },
    ]);
  });

  it('does not alert at stations that are not next to a transfer or the destination', () => {
    expect(plan(transferRoute, stationIds, '02_A')).toEqual([]);
    expect(plan(transferRoute, stationIds, '02_B')).toEqual([]);
    expect(plan(directRoute, ['02_A', '02_B', '02_C'], '02_A')).toEqual([]);
  });

  it('does not say transfer now at the destination', () => {
    expect(plan(directRoute, ['02_A', '02_B', '02_C'], '02_C')).toEqual([]);
  });

  it('skips alerts that were already sent', () => {
    expect(plan(transferRoute, stationIds, '02_C', ['TRANSFER_PREPARE:0'])).toEqual([]);
    expect(plan(transferRoute, stationIds, '02_X', ['TRANSFER_PREPARE:0']).map((a) => a.key)).toEqual([
      'TRANSFER_NOW:0',
    ]);
  });

  it('returns nothing when the current station is not on the route', () => {
    expect(plan(transferRoute, stationIds, '09_Q')).toEqual([]);
  });
});
