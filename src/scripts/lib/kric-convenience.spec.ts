import { existsSync } from 'fs';
import { join } from 'path';
import {
  aggregateDoors,
  buildKricStationMap,
  extractKricBody,
  formatDoor,
  parseCarNumberRows,
  sortDoors,
} from './kric-convenience';
import { RAW_DIR, StationRecord } from './subway-common';

// data-raw/는 git에 없는 로컬 데이터라 없는 환경(CI)에서는 건너뛴다
const hasRawData = existsSync(join(RAW_DIR, 'kric-route-2.json'));

describe('kric-convenience', () => {
  describe('formatDoor', () => {
    it('formats car and door as car-door', () => {
      expect(formatDoor(2, 1)).toBe('2-1');
      expect(formatDoor(10, 4)).toBe('10-4');
    });
  });

  describe('sortDoors', () => {
    it('sorts doors numerically by car number first, then door number', () => {
      const input = ['10-4', '2-1', '4-2', '2-4', '1-1'];
      expect(sortDoors(input)).toEqual(['1-1', '2-1', '2-4', '4-2', '10-4']);
    });

    it('deduplicates identical door labels', () => {
      const input = ['4-1', '2-1', '4-1', '2-1'];
      expect(sortDoors(input)).toEqual(['2-1', '4-1']);
    });
  });

  describe('extractKricBody', () => {
    it('handles flat body array', () => {
      const json = { body: [{ a: 1 }, { a: 2 }] };
      expect(extractKricBody(json)).toEqual([{ a: 1 }, { a: 2 }]);
    });

    it('handles nested items.item array', () => {
      const json = { body: { items: { item: [{ b: 1 }] } } };
      expect(extractKricBody(json)).toEqual([{ b: 1 }]);
    });

    it('returns empty array when missing or null', () => {
      expect(extractKricBody(null)).toEqual([]);
      expect(extractKricBody({})).toEqual([]);
    });
  });

  describe('parseCarNumberRows', () => {
    it('parses valid car and door rows and ignores invalid rows', () => {
      const json = {
        body: [
          {
            railOprIsttCd: 'S1',
            lnCd: '2',
            stinCd: '201',
            plfNo: 1,
            carOrdr: 2,
            carEtrcNo: 1,
          },
          {
            railOprIsttCd: 'S1',
            lnCd: '2',
            stinCd: '201',
            plfNo: 2,
            carOrdr: 10,
            carEtrcNo: 4,
          },
          {
            // invalid: carOrdr is 0
            carOrdr: 0,
            carEtrcNo: 1,
          },
        ],
      };
      const rows = parseCarNumberRows(json);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ carOrdr: 2, carEtrcNo: 1, plfNo: 1 });
      expect(rows[1]).toMatchObject({ carOrdr: 10, carEtrcNo: 4, plfNo: 2 });
    });
  });

  describe('aggregateDoors', () => {
    it('aggregates and groups doors by platform and sorted overall list', () => {
      const station: StationRecord = {
        id: '02_201',
        lineId: '02',
        stationCode: '201',
        stationName: '시청',
        lat: 37.5,
        lng: 126.9,
      };
      const kricInfo = { railOprIsttCd: 'S1', lnCd: '2', stinCd: '201' };
      const rows = [
        {
          railOprIsttCd: 'S1',
          lnCd: '2',
          stinCd: '201',
          plfNo: 1,
          carOrdr: 4,
          carEtrcNo: 4,
        },
        {
          railOprIsttCd: 'S1',
          lnCd: '2',
          stinCd: '201',
          plfNo: 1,
          carOrdr: 2,
          carEtrcNo: 1,
        },
        {
          railOprIsttCd: 'S1',
          lnCd: '2',
          stinCd: '201',
          plfNo: 2,
          carOrdr: 1,
          carEtrcNo: 1,
        },
      ];

      const agg = aggregateDoors(station, kricInfo, rows);
      expect(agg.stationId).toBe('02_201');
      expect(agg.doors).toEqual(['1-1', '2-1', '4-4']);
      expect(agg.doorsByPlf[1]).toEqual(['2-1', '4-4']);
      expect(agg.doorsByPlf[2]).toEqual(['1-1']);
    });
  });

  describe('buildKricStationMap', () => {
    (hasRawData ? it : it.skip)('maps stations using real data-raw route files', () => {
      const stations: StationRecord[] = [
        {
          id: '02_201',
          lineId: '02',
          stationCode: '201',
          stationName: '시청',
          lat: 37.5,
          lng: 126.9,
        },
        {
          id: '04_432',
          lineId: '04',
          stationCode: '432',
          stationName: '총신대입구',
          lat: 37.4,
          lng: 126.9,
        },
      ];
      const map = buildKricStationMap(stations);
      expect(map.get('02_201')).toMatchObject({
        railOprIsttCd: 'S1',
        lnCd: '2',
        stinCd: '201',
      });
      expect(map.get('04_432')).toMatchObject({
        railOprIsttCd: 'S1',
        lnCd: '4',
        stinCd: '432',
      });
    });
  });
});
