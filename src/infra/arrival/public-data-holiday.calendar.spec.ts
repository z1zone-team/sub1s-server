import { ConfigService } from '@nestjs/config';
import { PublicDataHolidayCalendar } from './public-data-holiday.calendar';

describe('PublicDataHolidayCalendar', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  const calendar = (key: string | null = 'k') =>
    new PublicDataHolidayCalendar({ get: () => key ?? undefined } as unknown as ConfigService);

  const respond = (items: unknown, resultCode = '00', init: { ok?: boolean; status?: number } = {}) =>
    fetchMock.mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => ({
        response: { header: { resultCode }, body: { items } },
      }),
    });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('knows the public holidays of the month', async () => {
    respond({
      item: [
        { dateName: '한글날', isHoliday: 'Y', locdate: 20261009 },
        { dateName: '대체공휴일', isHoliday: 'Y', locdate: 20261005 },
      ],
    });
    const target = calendar();

    expect(await target.isPublicHoliday('2026-10-09')).toBe(true);
    expect(await target.isPublicHoliday('2026-10-05')).toBe(true);
    expect(await target.isPublicHoliday('2026-10-12')).toBe(false);
  });

  it('handles a month with a single holiday, which the API returns as an object', async () => {
    respond({ item: { dateName: '한글날', isHoliday: 'Y', locdate: 20261009 } });

    expect(await calendar().isPublicHoliday('2026-10-09')).toBe(true);
  });

  it('handles a month without holidays, which the API returns as an empty string', async () => {
    respond('');

    expect(await calendar().isPublicHoliday('2026-11-10')).toBe(false);
  });

  it('ignores entries that are not days off', async () => {
    respond({ item: { dateName: '기념일', isHoliday: 'N', locdate: 20261001 } });

    expect(await calendar().isPublicHoliday('2026-10-01')).toBe(false);
  });

  it('asks once per month and shares the request between concurrent callers', async () => {
    respond({ item: { isHoliday: 'Y', locdate: 20261009 } });
    const target = calendar();

    await Promise.all([target.isPublicHoliday('2026-10-09'), target.isPublicHoliday('2026-10-12')]);
    await target.isPublicHoliday('2026-10-20');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('solYear=2026&solMonth=10');
  });

  it('asks again for another month', async () => {
    respond('');
    const target = calendar();

    await target.isPublicHoliday('2026-10-09');
    await target.isPublicHoliday('2026-11-09');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes the month after a day', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-11T00:00:00Z'));
    respond('');
    const target = calendar();

    await target.isPublicHoliday('2026-10-09');
    now.mockReturnValue(Date.parse('2026-10-11T23:00:00Z'));
    await target.isPublicHoliday('2026-10-09');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now.mockReturnValue(Date.parse('2026-10-12T01:00:00Z'));
    await target.isPublicHoliday('2026-10-09');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe('when the lookup fails', () => {
    it('treats every day as a normal day for an API error code, an HTTP error, a network error, or a missing key', async () => {
      respond('', '99');
      expect(await calendar().isPublicHoliday('2026-10-09')).toBe(false);

      respond('', '00', { ok: false, status: 500 });
      expect(await calendar().isPublicHoliday('2026-10-09')).toBe(false);

      fetchMock.mockRejectedValue(new Error('timeout'));
      expect(await calendar().isPublicHoliday('2026-10-09')).toBe(false);

      fetchMock.mockClear();
      expect(await calendar(null).isPublicHoliday('2026-10-09')).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not retry for ten minutes and then tries again', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-11T00:00:00Z'));
      fetchMock.mockRejectedValue(new Error('timeout'));
      const target = calendar();

      await target.isPublicHoliday('2026-10-09');
      now.mockReturnValue(Date.parse('2026-10-11T00:05:00Z'));
      await target.isPublicHoliday('2026-10-09');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      now.mockReturnValue(Date.parse('2026-10-11T00:11:00Z'));
      await target.isPublicHoliday('2026-10-09');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('does not double-encode a key that is already URL-encoded', async () => {
    respond('');

    await calendar('abc%2Bdef%3D').isPublicHoliday('2026-10-09');

    expect(fetchMock.mock.calls[0][0]).toContain('ServiceKey=abc%2Bdef%3D');
  });
});
