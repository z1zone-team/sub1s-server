import {
  MOLIT_FAST_TRANSFER_URL,
  applyFastTransferDoors,
  buildFastTransferDoors,
  buildFastTransferUrl,
  parseFastTransferResponse,
} from './molit-fast-transfer';
import { TransferNode, TransferRow } from './transfers';

describe('molit fast transfer', () => {
  const row = {
    철도운영기관명: '서울교통공사',
    노선명: '2호선',
    역명: '강남',
    종착역명: '성수',
    환승철도운영기관명: '신분당선(주)',
    환승선: '신분당선',
    환승이후역명: '신사',
    환승기점역명: '광교',
    차량순서: 5,
    차량출입문번호: 2,
  };

  describe('buildFastTransferUrl', () => {
    it('encodes a plain key', () => {
      const url = buildFastTransferUrl('ab+/=');

      expect(url.startsWith(MOLIT_FAST_TRANSFER_URL)).toBe(true);
      expect(url).toContain('serviceKey=ab%2B%2F%3D');
    });

    it('keeps a key that is already encoded', () => {
      expect(buildFastTransferUrl('ab%2B%2F%3D')).toContain('serviceKey=ab%2B%2F%3D');
    });
  });

  describe('parseFastTransferResponse', () => {
    it('returns a response that holds every row', () => {
      const body = { page: 1, perPage: 2000, totalCount: 1, currentCount: 1, data: [row] };

      expect(parseFastTransferResponse(body).data).toEqual([row]);
    });

    it('throws the API error such as an unregistered key', () => {
      expect(() => parseFastTransferResponse({ code: -4, msg: '등록되지 않은 인증키 입니다.' })).toThrow(
        'API error -4',
      );
    });

    it('throws when only part of the rows came back', () => {
      const body = { page: 1, perPage: 1, totalCount: 2, currentCount: 1, data: [row] };

      expect(() => parseFastTransferResponse(body)).toThrow('incomplete response');
    });

    it('throws on an unexpected shape', () => {
      expect(() => parseFastTransferResponse({ hello: 'world' })).toThrow('unexpected response shape');
    });
  });
  describe('fast transfer doors', () => {
    const fast = (노선명: string, 역명: string, 환승선: string, 칸: number, 문: number) => ({
      ...row,
      노선명,
      역명,
      환승선,
      차량순서: 칸,
      차량출입문번호: 문,
    });
    const node = (id: string, lineId: string, stationName: string): TransferNode => ({
      id,
      lineId,
      stationName,
      lat: 0,
      lng: 0,
    });
    const lineNames = { '01': '1호선', '02': '2호선', GJ: '경의중앙선', SD: '수인분당선' };

    describe('buildFastTransferDoors', () => {
      it('collects the doors of every direction in car and door order without duplicates', () => {
        const doors = buildFastTransferDoors([
          fast('경의중앙', '청량리', '1호선', 6, 4),
          fast('경의중앙', '청량리', '1호선', 3, 3),
          fast('경의중앙', '청량리', '1호선', 6, 2),
          fast('경의중앙', '청량리', '1호선', 3, 3),
        ]);

        expect(doors.get('경의중앙|청량리|1호')).toEqual(['3-3', '6-2', '6-4']);
      });

      it('ignores the parenthesis note of a station name', () => {
        const doors = buildFastTransferDoors([fast('1호선', '청량리(서울시립대입구)', '경의중앙', 1, 1)]);

        expect(doors.has('1호|청량리|경의중앙')).toBe(true);
      });

      it('skips rows without a line, a station or a door', () => {
        const doors = buildFastTransferDoors([
          { ...row, 노선명: null as unknown as string },
          { ...row, 차량순서: null as unknown as number },
        ]);

        expect(doors.size).toBe(0);
      });
    });

    describe('applyFastTransferDoors', () => {
      const stations = [
        node('01_124', '01', '청량리'),
        node('GJ_K117', 'GJ', '청량리'),
        node('SD_K209', 'SD', '청량리'),
        node('02_222', '02', '선릉'),
      ];
      const transfer = (from: string, to: string, doors?: string[]): TransferRow => ({
        fromStationId: from,
        toStationId: to,
        walkingDurationSec: 100,
        ...(doors ? { recommendedDoors: doors } : {}),
      });
      const rows = [fast('경의중앙', '청량리', '1호선', 3, 3), fast('1호선', '청량리(서울시립대입구)', '경의중앙', 1, 1)];

      it('replaces the doors when the new data has the transfer and keeps the rest of the row', () => {
        const { transfers, stats } = applyFastTransferDoors(
          [transfer('GJ_K117', '01_124', ['9-9'])],
          stations,
          lineNames,
          rows,
        );

        expect(transfers).toEqual([{ ...transfer('GJ_K117', '01_124'), recommendedDoors: ['3-3'] }]);
        expect(stats).toEqual({ fromMolit: 1, kept: 0, empty: 0 });
      });

      it('keeps the existing doors when the new data does not have the transfer', () => {
        const { transfers, stats } = applyFastTransferDoors(
          [transfer('SD_K209', '01_124', ['2-1', '7-4']), transfer('SD_K209', 'GJ_K117', [])],
          stations,
          lineNames,
          rows,
        );

        expect(transfers.map((t) => t.recommendedDoors)).toEqual([['2-1', '7-4'], []]);
        expect(stats).toEqual({ fromMolit: 0, kept: 1, empty: 1 });
      });

      it('does not mix stations that only share a character such as 선', () => {
        const { stats } = applyFastTransferDoors(
          [transfer('02_222', '01_124')],
          stations,
          lineNames,
          [fast('2호선', '릉', '1호선', 1, 1)],
        );

        expect(stats.fromMolit).toBe(0);
      });

      it('gives the same result when it runs twice', () => {
        const input = [transfer('GJ_K117', '01_124', ['9-9']), transfer('SD_K209', '01_124', ['2-1'])];
        const once = applyFastTransferDoors(input, stations, lineNames, rows).transfers;
        const twice = applyFastTransferDoors(once, stations, lineNames, rows).transfers;

        expect(twice).toEqual(once);
      });
    });
  });
});
