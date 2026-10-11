import { TrainDirection } from '../../domain/arrival/ports/INextTrainProvider';
import { KricTimetableRow } from './kric-timetable';
import { ScheduleContext, buildStationSchedules } from './next-train-schedule';

describe('buildStationSchedules', () => {
  const names: Record<string, string> = { A: '가양', B: '증미', C: '등촌', D: '염창' };
  const base = { railOprIsttCd: 'S9', lnCd: '9', dayCd: '8' };

  const context: ScheduleContext = {
    resolveStation: (key) => {
      const code = key.split('_')[2];
      return names[code] ? { id: `09_${code}`, stationName: names[code] } : undefined;
    },
    edgeDirection: (from, to): TrainDirection | undefined => {
      const order = ['09_A', '09_B', '09_C', '09_D'];
      const a = order.indexOf(from);
      const b = order.indexOf(to);
      if (a < 0 || b < 0) return undefined;
      return b > a ? 'DOWN' : 'UP';
    },
  };

  const row = (
    trnNo: string,
    stinCd: string,
    arvTm: string | null,
    dptTm: string | null,
    exptCd: string | null = null,
  ): KricTimetableRow => ({ ...base, trnNo, stinCd, arvTm, dptTm, exptCd });

  it('collects the departure times of each station by direction and destination', () => {
    const rows = [
      row('9001', 'A', null, '060000'),
      row('9001', 'B', '060200', '060230'),
      row('9001', 'C', '060500', null),
      row('9002', 'A', null, '061000'),
      row('9002', 'B', '061200', '061230'),
      row('9002', 'C', '061500', null),
    ];

    const result = buildStationSchedules(rows, context);

    expect(result.get('09_A')).toEqual([['DOWN', '등촌', 0, [21600, 22200]]]);
    expect(result.get('09_B')).toEqual([['DOWN', '등촌', 0, [21750, 22350]]]);
  });

  it('does not list the terminal station because the train does not depart from it', () => {
    const rows = [row('9001', 'A', null, '060000'), row('9001', 'B', '060300', null)];

    expect(buildStationSchedules(rows, context).has('09_B')).toBe(false);
  });

  it('reads the direction from the order of stops, so reverse trains go UP', () => {
    const rows = [
      row('9101', 'C', null, '070000'),
      row('9101', 'B', '070200', '070230'),
      row('9101', 'A', '070500', null),
    ];

    const result = buildStationSchedules(rows, context);

    expect(result.get('09_C')).toEqual([['UP', '가양', 0, [25200]]]);
  });

  it('sorts stops by time even when the rows come in any order', () => {
    const rows = [
      row('9001', 'C', '060500', null),
      row('9001', 'A', null, '060000'),
      row('9001', 'B', '060200', '060230'),
    ];

    expect(buildStationSchedules(rows, context).get('09_A')).toEqual([['DOWN', '등촌', 0, [21600]]]);
  });

  it('drops the stations an express train passes and keeps the express flag', () => {
    const rows = [
      row('9201', 'A', null, '080000', '1'),
      row('9201', 'B', null, null, '1'),
      row('9201', 'D', '080800', null, '1'),
    ];

    const result = buildStationSchedules(rows, context);

    expect(result.get('09_A')).toEqual([['DOWN', '염창', 1, [28800]]]);
    expect(result.has('09_B')).toBe(false);
  });

  it('counts trains after midnight as part of the same service day', () => {
    const rows = [
      row('9301', 'A', null, '235500'),
      row('9301', 'B', '000100', '000130'),
      row('9301', 'C', '000400', null),
    ];

    const result = buildStationSchedules(rows, context);

    expect(result.get('09_A')?.[0][3]).toEqual([86100]);
    expect(result.get('09_B')?.[0][3]).toEqual([86490]);
  });

  it('keeps trains with the same number from different operators apart', () => {
    const rows = [
      row('1', 'A', null, '060000'),
      row('1', 'B', '060300', null),
      { ...row('1', 'C', null, '061000'), railOprIsttCd: 'ZZ' },
      { ...row('1', 'D', '061300', null), railOprIsttCd: 'ZZ' },
    ];

    const result = buildStationSchedules(rows, context);

    expect(result.get('09_A')).toEqual([['DOWN', '증미', 0, [21600]]]);
  });

  it('skips stations it cannot resolve and trains without a known direction', () => {
    const rows = [
      row('9401', 'X', null, '090000'),
      row('9401', 'A', '090300', '090330'),
      row('9401', 'B', '090600', null),
      row('9402', 'X', null, '091000'),
      row('9402', 'Y', '091300', null),
    ];

    const result = buildStationSchedules(rows, context);

    expect(result.get('09_A')).toEqual([['DOWN', '증미', 0, [32610]]]);
    expect(result.size).toBe(1);
  });

  it('removes duplicate times', () => {
    const rows = [
      row('9001', 'A', null, '060000'),
      row('9001', 'B', '060300', null),
      row('9002', 'A', null, '060000'),
      row('9002', 'B', '060300', null),
    ];

    expect(buildStationSchedules(rows, context).get('09_A')?.[0][3]).toEqual([21600]);
  });
});
