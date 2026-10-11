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
});
