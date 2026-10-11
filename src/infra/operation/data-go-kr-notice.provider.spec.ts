import { ConfigService } from '@nestjs/config';
import { DataGoKrNoticeProvider } from './data-go-kr-notice.provider';

describe('DataGoKrNoticeProvider', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  const provider = (key: string | null = 'k') =>
    new DataGoKrNoticeProvider({ get: () => key ?? undefined } as unknown as ConfigService);

  const item = (over: Record<string, unknown> = {}) => ({
    noftTtl: '2호선 이대역 안전문장애로 열차 무정차 통과중',
    noftOcrnDt: '2026-09-22T21:22:23',
    noftSeCd: '4',
    lineNmLst: '2호선',
    ...over,
  });

  const respond = (items: unknown, resultCode = '00', init: { ok?: boolean; status?: number } = {}) =>
    fetchMock.mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => ({ response: { header: { resultCode }, body: { items } } }),
    });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('reads the notices with the time as KST and the line as our line id', async () => {
    respond({ item: [item(), item({ noftTtl: '1호선, 4호선 서울역 무정차', lineNmLst: '1호선, 4호선', noftSeCd: '6' })] });

    const notices = await provider().fetchRecentNotices();

    expect(notices).toEqual([
      {
        title: '2호선 이대역 안전문장애로 열차 무정차 통과중',
        occurredAt: Date.parse('2026-09-22T21:22:23+09:00'),
        categoryCode: '4',
        lineIds: ['02'],
      },
      expect.objectContaining({ lineIds: ['01', '04'], categoryCode: '6' }),
    ]);
  });

  it('asks for the newest hundred notices with the key as it is when it is already URL-encoded', async () => {
    respond({ item: [] });

    await provider('abc%2Bdef%3D').fetchRecentNotices();

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('https://apis.data.go.kr/B553766/ntce/getNtceList?');
    expect(url).toContain('serviceKey=abc%2Bdef%3D');
    expect(url).toContain('numOfRows=100');
    expect(url).toContain('dataType=JSON');
  });

  it('handles a single notice returned as an object and an empty result returned as an empty string', async () => {
    respond({ item: item() });
    expect(await provider().fetchRecentNotices()).toHaveLength(1);

    respond('');
    expect(await provider().fetchRecentNotices()).toEqual([]);
  });

  it('skips notices without a title or with an unreadable time, and keeps notices without a line', async () => {
    respond({
      item: [item({ noftTtl: '' }), item({ noftOcrnDt: 'garbage' }), item({ noftOcrnDt: null }), item({ lineNmLst: null })],
    });

    const notices = await provider().fetchRecentNotices();

    expect(notices).toHaveLength(1);
    expect(notices?.[0].lineIds).toEqual([]);
  });

  describe('caching', () => {
    it('serves the same notices for a minute and then asks again', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      respond({ item: [item()] });
      const target = provider();

      await target.fetchRecentNotices();
      now.mockReturnValue(1_000_000 + 59_000);
      await target.fetchRecentNotices();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000_000 + 61_000);
      await target.fetchRecentNotices();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('shares one request between concurrent callers', async () => {
      respond({ item: [item()] });
      const target = provider();

      await Promise.all([target.fetchRecentNotices(), target.fetchRecentNotices(), target.fetchRecentNotices()]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('failures', () => {
    it('answers null when nothing has ever been loaded: an error code, an HTTP error, a network error, a missing key', async () => {
      respond({ item: [] }, '99');
      expect(await provider().fetchRecentNotices()).toBeNull();

      respond({ item: [] }, '00', { ok: false, status: 500 });
      expect(await provider().fetchRecentNotices()).toBeNull();

      fetchMock.mockRejectedValue(new Error('timeout'));
      expect(await provider().fetchRecentNotices()).toBeNull();

      fetchMock.mockClear();
      expect(await provider(null).fetchRecentNotices()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not hammer the API after a failure', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      fetchMock.mockRejectedValue(new Error('timeout'));
      const target = provider();

      await target.fetchRecentNotices();
      now.mockReturnValue(1_000_000 + 5_000);
      await target.fetchRecentNotices();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000_000 + 11_000);
      await target.fetchRecentNotices();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('keeps serving the last notices for ten minutes after a failure and then gives up', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      respond({ item: [item()] });
      const target = provider();
      await target.fetchRecentNotices();

      fetchMock.mockRejectedValue(new Error('down'));
      now.mockReturnValue(1_000_000 + 5 * 60_000);
      expect(await target.fetchRecentNotices()).toHaveLength(1);

      now.mockReturnValue(1_000_000 + 11 * 60_000);
      expect(await target.fetchRecentNotices()).toBeNull();
    });

    it('never puts the key in the logs', async () => {
      fetchMock.mockRejectedValue(new Error('failed https://apis.data.go.kr/x?serviceKey=SECRETKEY'));
      const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation();

      await provider('SECRETKEY').fetchRecentNotices();

      expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRETKEY');
    });
  });
});
