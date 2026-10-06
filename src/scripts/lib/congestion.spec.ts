import {
  CongestionSheetRow,
  DAY_TYPES,
  SLOT_COUNT,
  buildCongestionRecords,
} from './congestion';

const SLOT_VALUES = Array.from({ length: SLOT_COUNT }, (_, i) => i + 0.5);

const row = (
  line: string,
  stationNo: number,
  name: string,
  direction: string,
  values: number[] = SLOT_VALUES,
): CongestionSheetRow => ({
  line,
  stationNo,
  stationName: name,
  direction,
  rates: values,
});

const stations = [
  { id: '02_222', lineId: '02', stationName: '강남' },
  { id: '02_211', lineId: '02', stationName: '성수' },
  { id: '03_349', lineId: '03', stationName: '수서' },
  { id: '04_426', lineId: '04', stationName: '서울역' },
  { id: '01_133', lineId: '01', stationName: '서울역' },
];

describe('buildCongestionRecords', () => {
  it('maps line, name and direction to our station ids and direction codes', () => {
    const { records } = buildCongestionRecords(
      {
        WEEKDAY: [
          row('2호선', 222, '강남', '내선'),
          row('2호선', 222, '강남', '외선'),
          row('3호선', 349, '수서', '상선'),
          row('4호선', 426, '서울역', '하선'),
        ],
        SATURDAY: [],
        SUNDAY: [],
      },
      stations,
    );

    expect(records.map((r) => [r.stationId, r.direction, r.dayType])).toEqual([
      ['02_222', 'INNER', 'WEEKDAY'],
      ['02_222', 'OUTER', 'WEEKDAY'],
      ['03_349', 'UP', 'WEEKDAY'],
      ['04_426', 'DOWN', 'WEEKDAY'],
    ]);
  });

  it('keeps the original rates without changing them', () => {
    const rates = SLOT_VALUES.map((v) => v + 0.123456789012345);
    const { records } = buildCongestionRecords(
      {
        WEEKDAY: [row('2호선', 222, '강남', '내선', rates)],
        SATURDAY: [],
        SUNDAY: [],
      },
      stations,
    );

    expect(records[0].rates).toEqual(rates);
  });

  it('matches the same station name on different lines separately', () => {
    const { records } = buildCongestionRecords(
      {
        WEEKDAY: [
          row('1호선', 150, '서울역', '상선'),
          row('4호선', 426, '서울역', '상선'),
        ],
        SATURDAY: [],
        SUNDAY: [],
      },
      stations,
    );

    expect(records.map((r) => r.stationId)).toEqual(['01_133', '04_426']);
  });

  it('skips special branch codes (9xxx) and prefers the regular station number', () => {
    const { records, skipped } = buildCongestionRecords(
      {
        WEEKDAY: [
          row('2호선', 9002, '성수', '내선'),
          row('2호선', 211, '성수', '내선'),
          row('2호선', 9001, '성수E', '내선'),
        ],
        SATURDAY: [],
        SUNDAY: [],
      },
      stations,
    );

    expect(records).toHaveLength(1);
    expect(records[0].stationId).toBe('02_211');
    expect(skipped.specialCode).toBe(2);
  });

  it('reports stations that are not in our data', () => {
    const { records, skipped } = buildCongestionRecords(
      {
        WEEKDAY: [row('2호선', 999, '없는역', '내선')],
        SATURDAY: [],
        SUNDAY: [],
      },
      stations,
    );

    expect(records).toEqual([]);
    expect(skipped.unmatched).toEqual(['02|없는역']);
  });

  it('rejects an unknown direction label or a wrong number of slots', () => {
    expect(() =>
      buildCongestionRecords(
        {
          WEEKDAY: [row('2호선', 222, '강남', '위')],
          SATURDAY: [],
          SUNDAY: [],
        },
        stations,
      ),
    ).toThrow(/direction/);
    expect(() =>
      buildCongestionRecords(
        {
          WEEKDAY: [row('2호선', 222, '강남', '내선', [1, 2, 3])],
          SATURDAY: [],
          SUNDAY: [],
        },
        stations,
      ),
    ).toThrow(/slots/);
  });

  it('exposes the three day types', () => {
    expect(DAY_TYPES).toEqual(['WEEKDAY', 'SATURDAY', 'SUNDAY']);
  });
});
