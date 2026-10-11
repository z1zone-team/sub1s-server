import {
  ACTIVE_WINDOW_MS,
  LineStation,
  OperationNotice,
  affectedStationIds,
  findActiveIncidents,
  isResolutionTitle,
  operationOfSegment,
  parseLineIds,
  summarizeOperation,
} from './operation-status';

const station = (id: string, name: string, lineSeq: number): LineStation => ({ id, name, lineSeq });

const LINE_2 = [
  station('02_240', '충정로', 1),
  station('02_241', '이대', 2),
  station('02_242', '신촌', 3),
  station('02_243', '홍대입구', 4),
  station('02_211-3', '용두', 50),
];
const LINE_1 = [station('01_133', '서울', 1), station('01_132', '남영', 2), station('01_131', '용산', 3), station('01_130', '노량진', 4), station('01_129', '대방', 5), station('01_128', '신길', 6), station('01_127', '영등포', 7), station('01_126', '신도림', 8), station('01_125', '구로', 9)];
const stationsOfLine = (lineId: string): LineStation[] => ({ '02': LINE_2, '01': LINE_1 })[lineId] ?? [];

const NOW = Date.parse('2026-10-11T12:00:00+09:00');
const minutesAgo = (minutes: number) => NOW - minutes * 60_000;
const notice = (title: string, minutes: number, over: Partial<OperationNotice> = {}): OperationNotice => ({
  title,
  occurredAt: minutesAgo(minutes),
  categoryCode: '6',
  lineIds: ['02'],
  ...over,
});

describe('parseLineIds', () => {
  it('maps numbered lines and the Ui-Sinseol line, in any list', () => {
    expect(parseLineIds('2호선')).toEqual(['02']);
    expect(parseLineIds('1호선, 4호선')).toEqual(['01', '04']);
    expect(parseLineIds('3호선,2호선,7호선')).toEqual(['03', '02', '07']);
    expect(parseLineIds('우이신설선')).toEqual(['UI']);
  });

  it('ignores empty values and names it does not know', () => {
    expect(parseLineIds(null)).toEqual([]);
    expect(parseLineIds('')).toEqual([]);
    expect(parseLineIds('경의중앙선')).toEqual([]);
  });
});

describe('isResolutionTitle', () => {
  it.each([
    '2호선 이대역 열차 운행재개',
    '2호선 이대역 열차 정상운행',
    '4호선(과천선) 선바위역 차량고장 조치완료',
    '5호선 여의나루역 무정차 통과 종료',
    '2호선 신도림역 출고열차 탈선 복구완료 및 열차 정상운행',
    '2호선 합정역 승강장 연기발생 진화완료',
  ])('recognizes "%s" as the end of an incident', (title) => {
    expect(isResolutionTitle(title)).toBe(true);
  });

  it.each([
    '2호선 이대역 안전문장애로 열차 무정차 통과중',
    '7호선 석남방면 차량고장으로 지연운행 알림',
    '5호선 열차지연',
    '2호선 신도림역 열차 탈선 관련 대체교통수단 이용 안내',
  ])('treats "%s" as an ongoing incident', (title) => {
    expect(isResolutionTitle(title)).toBe(false);
  });
});

describe('affectedStationIds', () => {
  it('finds the station named in the title', () => {
    expect(affectedStationIds('2호선 이대역 안전문장애로 열차 무정차 통과중', LINE_2)).toEqual(new Set(['02_241']));
  });

  it('finds a station on a branch', () => {
    expect(affectedStationIds('2호선 성수지선 용두역 무정차통과', LINE_2)).toEqual(new Set(['02_211-3']));
  });

  it('expands a section "A~B역간" to every station in between', () => {
    expect(affectedStationIds('1호선 코레일 구간 남영~구로역간 정전', LINE_1)).toEqual(
      new Set(['01_132', '01_131', '01_130', '01_129', '01_128', '01_127', '01_126', '01_125']),
    );
  });

  it('accepts a reversed section', () => {
    expect(affectedStationIds('구로~남영역간 정전', LINE_1)?.size).toBe(8);
  });

  it('returns null when the title names no station of the line, meaning the whole line', () => {
    expect(affectedStationIds('5호선 열차지연', LINE_2)).toBeNull();
    expect(affectedStationIds('2호선 서울역 무정차', LINE_2)).toBeNull();
    expect(affectedStationIds('', LINE_2)).toBeNull();
  });

  it('does not take a word that merely contains a station name', () => {
    expect(affectedStationIds('2호선 이대역사 외부 작업', LINE_2)).toBeNull();
  });
});

describe('findActiveIncidents', () => {
  const active = (notices: OperationNotice[]) => findActiveIncidents(notices, stationsOfLine, NOW);

  it('keeps a recent incident with the stations it affects', () => {
    const incidents = active([notice('2호선 이대역 안전문장애로 열차 무정차 통과중', 40, { categoryCode: '4' })]);

    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ lineId: '02', stationIds: new Set(['02_241']) });
  });

  it('drops the incident once a later notice resolves the same station', () => {
    expect(
      active([
        notice('2호선 이대역 내, 외선 무정차 통과중', 60),
        notice('2호선 이대역 열차 정상운행', 30),
      ]),
    ).toEqual([]);
  });

  it('does not let a resolution at another station clear the incident', () => {
    const incidents = active([
      notice('2호선 이대역 무정차 통과중', 60),
      notice('2호선 신촌역 열차 정상운행', 30),
    ]);

    expect(incidents.map((incident) => incident.notice.title)).toEqual(['2호선 이대역 무정차 통과중']);
  });

  it('lets a line-wide resolution clear a station incident and the other way round', () => {
    expect(active([notice('2호선 이대역 무정차 통과중', 60), notice('2호선 열차 정상운행', 30)])).toEqual([]);
    expect(active([notice('2호선 열차지연', 60), notice('2호선 이대역 열차 정상운행', 30)])).toEqual([]);
  });

  it('ignores a resolution that came before the incident', () => {
    expect(active([notice('2호선 이대역 열차 정상운행', 60), notice('2호선 이대역 무정차 통과중', 30)])).toHaveLength(1);
  });

  it('forgets an incident older than two hours even without a resolution', () => {
    expect(active([notice('2호선 이대역 무정차 통과중', ACTIVE_WINDOW_MS / 60_000 + 1)])).toEqual([]);
    expect(active([notice('2호선 이대역 무정차 통과중', ACTIVE_WINDOW_MS / 60_000 - 1)])).toHaveLength(1);
  });

  it('only counts incident categories, not timetable or operation-plan notices', () => {
    expect(
      active([
        notice('2호선 열차시간표 업데이트', 10, { categoryCode: '7' }),
        notice('서울시내버스파업 대비 연장운행계획 알림', 10, { categoryCode: '8' }),
      ]),
    ).toEqual([]);
  });

  it('skips notices without a line, such as the translated copies', () => {
    expect(active([notice('2호선 이대역 내, 외선 무정차 통과중', 10, { lineIds: [] })])).toEqual([]);
  });

  it('applies a multi-line notice to each of its lines', () => {
    const incidents = active([notice('서울역 열차 무정차 통과', 10, { lineIds: ['01', '04'] })]);

    expect(incidents.map((incident) => incident.lineId)).toEqual(['01', '04']);
    expect(incidents[0].stationIds).toEqual(new Set(['01_133']));
    expect(incidents[1].stationIds).toBeNull();
  });

  it('ignores a notice dated in the future', () => {
    expect(active([notice('2호선 이대역 무정차 통과중', -5)])).toEqual([]);
  });
});

describe('operationOfSegment', () => {
  const incident = (title: string, stations: string[] | null, lineId = '02') => ({
    notice: notice(title, 10),
    lineId,
    stationIds: stations ? new Set(stations) : null,
  });

  it('is DISRUPTED with the notice when the segment passes the affected station', () => {
    const result = operationOfSegment(
      '02',
      new Set(['02_240', '02_241', '02_242']),
      [incident('2호선 이대역 무정차 통과중', ['02_241'])],
      true,
    );

    expect(result.status).toBe('DISRUPTED');
    expect(result.notice?.title).toBe('2호선 이대역 무정차 통과중');
  });

  it('stays NORMAL when the segment does not pass the affected station', () => {
    expect(
      operationOfSegment('02', new Set(['02_242', '02_243']), [incident('2호선 이대역 무정차', ['02_241'])], true).status,
    ).toBe('NORMAL');
  });

  it('is DISRUPTED for any segment of a line when the incident is line-wide', () => {
    expect(operationOfSegment('02', new Set(['02_243']), [incident('2호선 열차지연', null)], true).status).toBe('DISRUPTED');
  });

  it('is NORMAL on a fully covered line without incidents and ignores other lines incidents', () => {
    expect(operationOfSegment('02', new Set(['02_243']), [incident('1호선 열차지연', null, '01')], true).status).toBe('NORMAL');
  });

  it('is UNKNOWN on a line the notices do not fully cover, unless there is an incident', () => {
    expect(operationOfSegment('09', new Set(['09_925']), [], true).status).toBe('UNKNOWN');
    expect(operationOfSegment('09', new Set(['09_925']), [incident('9호선 열차지연', null, '09')], true).status).toBe('DISRUPTED');
  });

  it('is UNKNOWN for everything when the notices could not be loaded', () => {
    expect(operationOfSegment('02', new Set(['02_243']), [], false).status).toBe('UNKNOWN');
  });
});

describe('summarizeOperation', () => {
  it('is DISRUPTED if any part is, NORMAL only if all parts are, and UNKNOWN otherwise', () => {
    expect(summarizeOperation(['NORMAL', 'DISRUPTED', 'UNKNOWN'])).toBe('DISRUPTED');
    expect(summarizeOperation(['NORMAL', 'NORMAL'])).toBe('NORMAL');
    expect(summarizeOperation(['NORMAL', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(summarizeOperation([])).toBe('UNKNOWN');
  });
});
