import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { trainCarCount } from './train-composition';

describe('trainCarCount', () => {
  it.each([
    ['01', 10],
    ['02', 10],
    ['03', 10],
    ['04', 10],
    ['05', 8],
    ['06', 8],
    ['07', 8],
    ['08', 6],
    ['09', 6],
    ['UI', 2],
    ['SL', 3],
    ['AR', 6],
    ['SB', 6],
    ['GM', 2],
  ])('호선 %s는 %i칸이다', (lineId, expected) => {
    expect(trainCarCount(lineId)).toBe(expected);
  });

  it.each(['GJ', 'SD', 'SH', 'UJ', 'GG', 'EV', 'GC', 'GA', 'I1', 'I2', 'XX'])(
    '공식 값을 확인하지 못한 노선 %s는 칸 수를 모른다(undefined)',
    (lineId) => {
      expect(trainCarCount(lineId)).toBeUndefined();
    },
  );

  describe('2호선 지선', () => {
    it.each(['02_211-1', '02_211-2', '02_211-3', '02_211-4'])(
      '성수지선 역 %s가 구간에 있으면 4칸이다',
      (stationId) => {
        expect(trainCarCount('02', ['02_211', stationId])).toBe(4);
        expect(trainCarCount('02', [stationId, '02_211'])).toBe(4);
      },
    );

    it.each(['02_234-1', '02_234-2', '02_234-3', '02_234-4'])(
      '신정지선 역 %s가 구간에 있으면 6칸이다',
      (stationId) => {
        expect(trainCarCount('02', ['02_234', stationId])).toBe(6);
        expect(trainCarCount('02', [stationId, '02_234'])).toBe(6);
      },
    );

    it('성수와 신도림은 순환선 역이라 10칸이다', () => {
      expect(trainCarCount('02', ['02_211', '02_210'])).toBe(10);
      expect(trainCarCount('02', ['02_234', '02_235'])).toBe(10);
    });

    it('역을 넘기지 않으면 순환선 10칸이다', () => {
      expect(trainCarCount('02')).toBe(10);
    });

    it('다른 호선은 2호선 지선 역 번호가 있어도 영향받지 않는다', () => {
      expect(trainCarCount('01', ['02_211-1'])).toBe(10);
    });

    it('지선 역 ID가 실제 역 데이터에 있고 이름이 맞다', () => {
      const stations = JSON.parse(
        readFileSync(resolve(__dirname, '../../../data/subway/stations.json'), 'utf-8'),
      ) as { id: string; stationName: string }[];
      const nameOf = (id: string) => stations.find((s) => s.id === id)?.stationName;

      expect(['02_211-1', '02_211-2', '02_211-3', '02_211-4'].map(nameOf)).toEqual([
        '용답',
        '신답',
        '용두',
        '신설동',
      ]);
      expect(['02_234-1', '02_234-2', '02_234-3', '02_234-4'].map(nameOf)).toEqual([
        '도림천',
        '양천구청',
        '신정네거리',
        '까치산',
      ]);
      expect(nameOf('02_211')).toBe('성수');
      expect(nameOf('02_234')).toBe('신도림');
    });
  });

  it('확인한 호선 코드가 실제 노선 데이터에 있다', () => {
    const lines = JSON.parse(
      readFileSync(resolve(__dirname, '../../../data/subway/lines.json'), 'utf-8'),
    ) as { id: string }[];
    const ids = new Set(lines.map((line) => line.id));

    for (const lineId of ['01', '02', '03', '04', '05', '06', '07', '08', '09', 'UI', 'SL', 'AR', 'SB', 'GM']) {
      expect(ids.has(lineId)).toBe(true);
    }
  });
});
