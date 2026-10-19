import { SeoulTimetableRow, buildSeoulGroups, parseClockSeconds } from './seoul-timetable';

describe('parseClockSeconds', () => {
  it('reads hh:mm:ss including times past midnight', () => {
    expect(parseClockSeconds('05:35:30')).toBe(5 * 3600 + 35 * 60 + 30);
    expect(parseClockSeconds('24:46:00')).toBe(24 * 3600 + 46 * 60);
  });

  it('returns null for empty, malformed or zero values', () => {
    expect(parseClockSeconds('')).toBeNull();
    expect(parseClockSeconds(null)).toBeNull();
    expect(parseClockSeconds('0535')).toBeNull();
    expect(parseClockSeconds('00:00:00')).toBeNull();
    expect(parseClockSeconds('05:61:00')).toBeNull();
  });
});

describe('buildSeoulGroups', () => {
  const row = (over: Partial<SeoulTimetableRow>): SeoulTimetableRow => ({
    FR_CODE: '222',
    STATION_CD: '0222',
    STATION_NM: '강남',
    ARRIVETIME: '05:35:00',
    LEFTTIME: '05:35:30',
    SUBWAYENAME: '성수',
    INOUT_TAG: '1',
    EXPRESS_YN: 'G',
    ...over,
  });
  const directionOf = (tag: string) => (tag === '1' ? 'INNER' : tag === '2' ? 'OUTER' : undefined);

  it('groups departures by direction and destination in time order without duplicates', () => {
    const groups = buildSeoulGroups(
      [
        row({ LEFTTIME: '06:02:00' }),
        row({ LEFTTIME: '05:35:30' }),
        row({ LEFTTIME: '06:02:00' }),
        row({ LEFTTIME: '05:50:00', SUBWAYENAME: '신도림' }),
        row({ LEFTTIME: '05:44:00', INOUT_TAG: '2', SUBWAYENAME: '성수' }),
      ],
      directionOf,
    );

    expect(groups).toEqual([
      ['INNER', '성수', 0, [5 * 3600 + 35 * 60 + 30, 6 * 3600 + 2 * 60]],
      ['INNER', '신도림', 0, [5 * 3600 + 50 * 60]],
      ['OUTER', '성수', 0, [5 * 3600 + 44 * 60]],
    ]);
  });

  it('counts after-midnight trains as the same service day', () => {
    const groups = buildSeoulGroups([row({ LEFTTIME: '24:46:00' }), row({ LEFTTIME: '00:10:00' })], directionOf);

    expect(groups[0][3]).toEqual([24 * 3600 + 10 * 60, 24 * 3600 + 46 * 60]);
  });

  it('skips terminating trains without a departure, unknown directions and rows without a destination', () => {
    const groups = buildSeoulGroups(
      [
        row({ LEFTTIME: '' }),
        row({ LEFTTIME: '00:00:00' }),
        row({ INOUT_TAG: '9' }),
        row({ SUBWAYENAME: '' }),
      ],
      directionOf,
    );

    expect(groups).toEqual([]);
  });

  it('marks non-general trains as express', () => {
    const groups = buildSeoulGroups([row({ EXPRESS_YN: 'D' })], directionOf);

    expect(groups[0][2]).toBe(1);
  });
});
