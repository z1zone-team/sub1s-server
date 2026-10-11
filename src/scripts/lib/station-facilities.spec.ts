import { KricGateRow } from './kric-convenience';
import { buildExits, buildStationFacilities } from './station-facilities';

describe('station facilities', () => {
  const gate = (exitNo: string, impFaclNm: string, adr: string | null = null): KricGateRow => ({
    railOprIsttCd: 'S1',
    lnCd: '2',
    stinCd: '222',
    exitNo,
    impFaclNm,
    adr,
  });

  describe('buildExits', () => {
    it('groups the facilities by exit and sorts the exits naturally', () => {
      const exits = buildExits([
        gate('10', '신한은행'),
        gate('2', '교보타워'),
        gate('2-1', '강남역사거리'),
        gate('1', '우리은행'),
        gate('2', '강남빌딩'),
      ]);

      expect(exits.map((exit) => exit.exitNo)).toEqual(['1', '2', '2-1', '10']);
      expect(exits[1].facilities.map((f) => f.name)).toEqual(['강남빌딩', '교보타워']);
    });

    it('keeps the address and turns blanks into null', () => {
      const [exit] = buildExits([gate('1', '시청', '서울 중구 세종대로 110'), gate('1', '별관', '  ')]);

      expect(exit.facilities).toEqual([
        { name: '별관', address: null },
        { name: '시청', address: '서울 중구 세종대로 110' },
      ]);
    });

    it('removes duplicate facilities of the same exit', () => {
      const [exit] = buildExits([gate('3', '병원', '주소'), gate('3', '병원', '주소'), gate('3', '병원', '다른 주소')]);

      expect(exit.facilities).toHaveLength(2);
    });

    it('skips rows without an exit number or a name', () => {
      expect(buildExits([gate('', '시설'), gate('4', ' '), gate('4', '약국')])).toEqual([
        { exitNo: '4', facilities: [{ name: '약국', address: null }] },
      ]);
    });

    it('returns nothing for a station without gates', () => {
      expect(buildExits([])).toEqual([]);
    });
  });

  describe('buildStationFacilities', () => {
    it('merges exits and elevator doors by station', () => {
      const result = buildStationFacilities(
        { '02_222': { gates: [gate('1', '은행')] } },
        { '02_222': { doors: ['1-1', '6-2'] } },
      );

      expect(result['02_222']).toEqual({
        exits: [{ exitNo: '1', facilities: [{ name: '은행', address: null }] }],
        elevatorDoors: ['1-1', '6-2'],
      });
    });

    it('includes a station that appears in only one of the sources', () => {
      const result = buildStationFacilities(
        { '01_147': { gates: [gate('1', '마당')] } },
        { '01_161': { doors: ['1-1'] } },
      );

      expect(result['01_147']).toEqual({ exits: expect.any(Array), elevatorDoors: [] });
      expect(result['01_161']).toEqual({ exits: [], elevatorDoors: ['1-1'] });
    });

    it('keeps a collected station even when it has no data, so it is not mistaken for uncollected', () => {
      const result = buildStationFacilities({ '01_147': { gates: [] } }, { '01_147': { doors: [] } });

      expect(result['01_147']).toEqual({ exits: [], elevatorDoors: [] });
    });

    it('orders the stations by id for stable diffs', () => {
      const result = buildStationFacilities({ '09_925': { gates: [] }, '01_100': { gates: [] } }, {});

      expect(Object.keys(result)).toEqual(['01_100', '09_925']);
    });
  });
});
