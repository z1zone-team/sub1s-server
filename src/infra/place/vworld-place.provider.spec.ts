import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VWorldPlaceProvider } from './vworld-place.provider';

describe('VWorldPlaceProvider', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  const provider = (key?: string) =>
    new VWorldPlaceProvider({
      get: () => key,
    } as unknown as ConfigService);

  const respond = (
    body: unknown,
    init: { ok?: boolean; status?: number } = {},
  ) =>
    fetchMock.mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    });

  const item = {
    title: '강남 교보타워',
    category: '업무시설',
    address: {
      road: '서울 서초구 강남대로 465',
      parcel: '서울 서초구 서초동 1303',
    },
    point: { x: '127.0243', y: '37.5035' },
  };

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('returns nothing and does not call the API without a key', async () => {
    expect(await provider(undefined).search('강남', 10)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests a PLACE search with the key and size', async () => {
    respond({ response: { status: 'NOT_FOUND' } });

    await provider('secret').search('교보타워', 7);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://api.vworld.kr/req/search');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      request: 'search',
      type: 'PLACE',
      format: 'json',
      crs: 'EPSG:4326',
      size: '7',
      query: '교보타워',
      key: 'secret',
    });
  });

  it('parses a response nested under `response`', async () => {
    respond({ response: { status: 'OK', result: { items: [item] } } });

    expect(await provider('k').search('교보타워', 10)).toEqual([
      {
        name: '강남 교보타워',
        address: '서울 서초구 강남대로 465',
        category: '업무시설',
        lat: 37.5035,
        lng: 127.0243,
      },
    ]);
  });

  it('parses a response with status and result at the top level', async () => {
    respond({ status: 'OK', result: { items: [item] } });

    const places = await provider('k').search('교보타워', 10);

    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ lat: 37.5035, lng: 127.0243 });
  });

  it('falls back to the parcel address when there is no road address', async () => {
    respond({
      status: 'OK',
      result: {
        items: [{ ...item, address: { parcel: '서울 서초구 서초동' } }],
      },
    });

    const [place] = await provider('k').search('교보타워', 10);

    expect(place.address).toBe('서울 서초구 서초동');
  });

  it('skips items without a title or with invalid coordinates', async () => {
    respond({
      status: 'OK',
      result: {
        items: [
          { ...item, title: undefined },
          { ...item, point: { x: 'abc', y: '37.5' } },
          { ...item, point: undefined },
          item,
        ],
      },
    });

    expect(await provider('k').search('교보타워', 10)).toHaveLength(1);
  });

  it.each(['NOT_FOUND', 'ERROR'])(
    'returns nothing for status %s',
    async (status) => {
      respond({ response: { status } });

      expect(await provider('k').search('교보타워', 10)).toEqual([]);
    },
  );

  describe('error logging', () => {
    const warn = () =>
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    afterEach(() => jest.restoreAllMocks());

    it('logs the reason V-World gives for an ERROR status', async () => {
      const spy = warn();
      respond({
        response: {
          status: 'ERROR',
          error: { code: 'INCORRECT_KEY', text: '인증키가 올바르지 않습니다' },
        },
      });

      expect(await provider('k').search('교보타워', 10)).toEqual([]);
      expect(spy).toHaveBeenCalledWith(
        'V-World search returned status ERROR (INCORRECT_KEY: 인증키가 올바르지 않습니다)',
      );
    });

    it('still logs when V-World gives no reason', async () => {
      const spy = warn();
      respond({ response: { status: 'ERROR' } });

      await provider('k').search('교보타워', 10);

      expect(spy).toHaveBeenCalledWith('V-World search returned status ERROR');
    });

    it('limits the length of the logged reason', async () => {
      const spy = warn();
      respond({
        response: { status: 'ERROR', error: { text: 'x'.repeat(500) } },
      });

      await provider('k').search('교보타워', 10);

      const message = String(spy.mock.calls[0][0]);
      expect(message.length).toBeLessThan(200);
    });

    it('does not log anything for NOT_FOUND', async () => {
      const spy = warn();
      respond({ response: { status: 'NOT_FOUND' } });

      await provider('k').search('교보타워', 10);

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('daily limit', () => {
    const limited = (limit: string) =>
      new VWorldPlaceProvider({
        get: (name: string) => (name === 'VWORLD_DAILY_LIMIT' ? limit : 'k'),
      } as unknown as ConfigService);

    it('stops calling V-World once the limit is used and starts again the next KST day', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-11T03:00:00Z'));
      respond({ status: 'OK', result: { items: [item] } });
      const target = limited('2');

      expect(await target.search('교보타워', 10)).toHaveLength(1);
      expect(await target.search('교보타워', 10)).toHaveLength(1);
      expect(await target.search('교보타워', 10)).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      now.mockReturnValue(Date.parse('2026-10-11T15:30:00Z'));
      expect(await target.search('교보타워', 10)).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not spend the budget when the key is missing', async () => {
      const target = new VWorldPlaceProvider({
        get: (name: string) => (name === 'VWORLD_DAILY_LIMIT' ? '1' : undefined),
      } as unknown as ConfigService);

      await target.search('교보타워', 10);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falls back to 10000 a day when the setting is missing or invalid', async () => {
      respond({ status: 'OK', result: { items: [item] } });
      const target = limited('abc');

      for (let i = 0; i < 100; i += 1) await target.search('교보타워', 10);

      expect(fetchMock).toHaveBeenCalledTimes(100);
    });
  });

  it('returns nothing on an HTTP error', async () => {
    respond({}, { ok: false, status: 500 });

    expect(await provider('k').search('교보타워', 10)).toEqual([]);
  });

  it('returns nothing when the request fails or times out', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));

    expect(await provider('k').search('교보타워', 10)).toEqual([]);
  });
  describe('주소 검색', () => {
    const roadItem = (building: string) => ({
      id: '1',
      address: {
        zipcode: '12762',
        category: 'ROAD',
        road: '경기도 광주시 문화로 67-1 (경안동,한솔빌라)',
        parcel: '경안동 167-42',
        bldnm: '한솔빌라',
        bldnmdc: building,
      },
      point: { x: '127.25283142566201', y: '37.40904320974688' },
    });
    const urlOf = (call: number) =>
      new URL(fetchMock.mock.calls[call][0] as string).searchParams;

    it('도로명 주소는 ADDRESS(ROAD)로 찾고 주소를 이름으로 쓴다', async () => {
      respond({
        response: { status: 'OK', result: { items: [roadItem('A동')] } },
      });

      const places = await provider('secret').search('문화로 67-1', 5);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(Object.fromEntries(urlOf(0))).toMatchObject({
        type: 'ADDRESS',
        category: 'ROAD',
        query: '문화로 67-1',
      });
      expect(places).toEqual([
        {
          name: '경기도 광주시 문화로 67-1',
          address: '경안동 167-42 한솔빌라',
          category: '도로명주소',
          lat: 37.40904320974688,
          lng: 127.25283142566201,
        },
      ]);
    });

    it('같은 주소가 동마다 나오면 하나로 합친다', async () => {
      respond({
        response: {
          status: 'OK',
          result: {
            items: [roadItem('A동'), roadItem('B동'), roadItem('C동')],
          },
        },
      });

      const places = await provider('secret').search('문화로 67-1', 5);

      expect(places).toHaveLength(1);
    });

    it('합친 뒤에도 limit개가 남도록 limit보다 넉넉히 요청한다', async () => {
      respond({ response: { status: 'NOT_FOUND' } });

      await provider('secret').search('문화로 67-1', 5);

      expect(urlOf(0).get('size')).toBe('15');
    });

    it('지번 주소는 ADDRESS(PARCEL)로 찾고 지번을 이름으로 쓴다', async () => {
      respond({
        response: {
          status: 'OK',
          result: {
            items: [
              {
                address: {
                  category: 'PARCEL',
                  road: '허준로 23',
                  parcel: '서울특별시 강서구 가양동 1460',
                  bldnm: '한강아파트',
                },
                point: { x: '126.8448', y: '37.5711' },
              },
            ],
          },
        },
      });

      const places = await provider('secret').search('가양동 1460', 5);

      expect(urlOf(0).get('category')).toBe('PARCEL');
      expect(places).toEqual([
        {
          name: '서울특별시 강서구 가양동 1460',
          address: '허준로 23 한강아파트',
          category: '지번주소',
          lat: 37.5711,
          lng: 126.8448,
        },
      ]);
    });

    it('주소 검색 결과가 limit을 넘으면 자른다', async () => {
      const items = [1, 2, 3, 4].map((n) => ({
        address: { road: `경기도 광주시 문화로 ${n}`, parcel: '경안동', bldnm: '' },
        point: { x: '127.2', y: '37.4' },
      }));
      respond({ response: { status: 'OK', result: { items } } });

      expect(await provider('secret').search('문화로 1', 2)).toHaveLength(2);
    });

    it('주소로 못 찾으면 장소 이름 검색(PLACE)으로 대체한다', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ response: { status: 'NOT_FOUND' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ response: { status: 'OK', result: { items: [item] } } }),
        });

      const places = await provider('secret').search('강남대로 465', 5);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(urlOf(0).get('type')).toBe('ADDRESS');
      expect(urlOf(1).get('type')).toBe('PLACE');
      expect(places.map((place) => place.name)).toEqual(['강남 교보타워']);
    });

    it('번지만 있는 입력은 V-World를 부르지 않는다', async () => {
      expect(await provider('secret').search('67-1', 5)).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('주소가 아닌 입력은 지금처럼 PLACE로만 찾는다', async () => {
      respond({ response: { status: 'NOT_FOUND' } });

      await provider('secret').search('서울시청', 5);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(urlOf(0).get('type')).toBe('PLACE');
      expect(urlOf(0).has('category')).toBe(false);
    });

    it('좌표가 없는 항목과 주소가 비어 있는 항목은 버린다', async () => {
      respond({
        response: {
          status: 'OK',
          result: {
            items: [
              { address: { road: '경기도 광주시 문화로 67-1' }, point: { x: 'x', y: 'y' } },
              { address: { road: '' }, point: { x: '127.2', y: '37.4' } },
              roadItem('A동'),
            ],
          },
        },
      });

      expect(await provider('secret').search('문화로 67-1', 5)).toHaveLength(1);
    });
  });
});
