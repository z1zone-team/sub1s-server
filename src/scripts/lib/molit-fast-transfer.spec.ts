import {
  MOLIT_FAST_TRANSFER_URL,
  buildFastTransferUrl,
  parseFastTransferResponse,
} from './molit-fast-transfer';

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
});
