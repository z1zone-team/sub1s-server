import {
  baseStationName,
  median,
  mentionsLine,
  parseLevels,
  pathLevels,
  pathMeters,
  rangeLevels,
  travel,
} from './station-vertical';

describe('station vertical parsing', () => {
  it('reads floor marks in order with 1F=0 and B1=-1', () => {
    expect(parseLevels('1) (1F) 7번 출입구 옆 엘리베이터 탑승')).toEqual([0]);
    expect(parseLevels('(B4) 을지로3가 방면 승강장')).toEqual([-4]);
    expect(parseLevels('지하1층 대합실, 지상2층 승강장')).toEqual([-1, 1]);
    expect(parseLevels('B2층 대합실로 이동')).toEqual([-2]);
    expect(parseLevels('승차(휠체어칸)')).toEqual([]);
  });

  it('counts every change, so going up to a concourse and back down is two levels', () => {
    expect(travel([0, 1, 0])).toEqual({ up: 1, down: 1 });
    expect(travel([0, -1, -2, -4])).toEqual({ up: 0, down: 4 });
    expect(travel([-4, -2, -3])).toEqual({ up: 2, down: 1 });
  });

  it('assumes the street level when an exit path does not say its floor', () => {
    expect(
      pathLevels(
        ['2번 출입구 근처 엘리베이터 이용', '지상 2층으로 이동'],
        true,
      ),
    ).toEqual([0, 1]);
    // 환승 경로에는 출입구 가정을 하지 않는다
    expect(
      pathLevels(['4호선 엘리베이터 탑승', '(B3) 승강장'], false),
    ).toBeNull();
    expect(pathLevels([], true)).toBeNull();
  });

  it('keeps the explicit first floor of an exit path', () => {
    expect(
      pathLevels(
        ['(1F) 7번 출입구 옆 엘리베이터 탑승', '(B1) 대합실', '(B4) 승강장'],
        true,
      ),
    ).toEqual([0, -1, -4]);
  });

  it('takes the median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });

  it('finds the target line in transfer text without confusing similar names', () => {
    expect(mentionsLine('4호선 명동 방면 엘리베이터 탑승', '04')).toBe(true);
    expect(mentionsLine('인천1호선 승강장', '01')).toBe(false);
    expect(mentionsLine('인천1호선 승강장', 'I1')).toBe(true);
    expect(mentionsLine('신분당선 승강장', 'SD')).toBe(false);
    expect(mentionsLine('분당선 승강장', 'SD')).toBe(true);
    expect(mentionsLine('수인분당선 승강장', 'SD')).toBe(true);
    expect(mentionsLine('신분당선 승강장', 'SB')).toBe(true);
    expect(mentionsLine('경의중앙선 문산 방면', 'GJ')).toBe(true);
    expect(mentionsLine('11호선', '01')).toBe(false);
  });

  it('reads Seoul Metro elevator ranges', () => {
    expect(rangeLevels('B2-1F')).toEqual([-2, 0]);
    expect(rangeLevels('1F-B1')).toEqual([0, -1]);
    expect(rangeLevels('2F-3F')).toEqual([1, 2]);
    expect(rangeLevels('B1-B1')).toBeNull();
    expect(rangeLevels('대합실-승강장')).toBeNull();
  });

  it('strips the line note from Seoul Metro station names', () => {
    expect(baseStationName('청량리(1)')).toBe('청량리');
    expect(baseStationName('제기동')).toBe('제기동');
  });

  it('adds measured span heights and falls back to the level height', () => {
    // 남태령: 1F-B1 10.4m, B1-B2 4.37m, B2-B3 44m(측정값 두 개의 중앙값이 아니라 같은 구간끼리)
    const spans = [
      { from: -1, to: 0, meters: 10.4 },
      { from: -2, to: -1, meters: 4.37 },
      { from: -3, to: -2, meters: 44 },
    ];
    const result = pathMeters([0, -1, -2, -3], spans, 5.8);
    expect(result.up).toBe(0);
    expect(result.down).toBeCloseTo(58.77, 2);
    // 측정값이 없는 구간은 한 층 높이 x 층 수, 오르면 up
    expect(pathMeters([-4, -2], [], 5)).toEqual({ up: 10, down: 0 });
    // 같은 두 층을 잇는 승강기가 여럿이면 중앙값
    expect(
      pathMeters(
        [0, -2],
        [
          { from: 0, to: -2, meters: 10 },
          { from: -2, to: 0, meters: 12 },
        ],
        5,
      ),
    ).toEqual({ up: 0, down: 11 });
  });
});
