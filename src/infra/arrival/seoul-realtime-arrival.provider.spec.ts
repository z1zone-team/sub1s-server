import { ConfigService } from '@nestjs/config';
import { SeoulRealtimeArrivalProvider } from './seoul-realtime-arrival.provider';

describe('SeoulRealtimeArrivalProvider', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  const provider = (env: Record<string, string | undefined> = { SEOUL_SUBWAY_REALTIME_API_KEY: 'k' }) =>
    new SeoulRealtimeArrivalProvider({ get: (name: string) => env[name] } as unknown as ConfigService);

  const respond = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
    fetchMock.mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    });

  const row = (over: Record<string, string> = {}) => ({
    subwayId: '1009',
    updnLine: '상행',
    trainLineNm: '개화행 - 구반포방면',
    bstatnNm: '개화',
    barvlDt: '120',
    arvlMsg2: '2분 후 [1번째 전역]',
    arvlMsg3: '구반포',
    arvlCd: '99',
    btrainSttus: '일반',
    ...over,
  });

  const query = { stationId: '09_925', lineId: '09', stationName: '신논현' };

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('maps the arrivals of the requested line only', async () => {
    respond({
      errorMessage: { code: 'INFO-000' },
      realtimeArrivalList: [
        row(),
        row({ subwayId: '1002', updnLine: '내선', bstatnNm: '성수', barvlDt: '60' }),
        row({ updnLine: '하행', bstatnNm: '중앙보훈병원', btrainSttus: '급행' }),
      ],
    });

    const snapshot = await provider().fetchNextTrains(query);

    expect(snapshot.status).toBe('OK');
    expect(snapshot.source).toBe('REALTIME');
    expect(snapshot.trains).toEqual([
      {
        direction: 'UP',
        headsign: '개화',
        arrivalInSec: 120,
        message: '2분 후 [1번째 전역]',
        isExpress: false,
        currentLocation: '구반포',
      },
      expect.objectContaining({ direction: 'DOWN', headsign: '중앙보훈병원', isExpress: true }),
    ]);
  });

  it('maps inner and outer directions of line 2', async () => {
    respond({
      realtimeArrivalList: [
        row({ subwayId: '1002', updnLine: '내선' }),
        row({ subwayId: '1002', updnLine: '외선' }),
      ],
    });

    const snapshot = await provider().fetchNextTrains({ stationId: 'x', lineId: '02', stationName: '강남' });

    expect(snapshot.trains.map((train) => train.direction)).toEqual(['INNER', 'OUTER']);
  });

  it('treats an arriving train as 0 seconds and an unknown time as null', async () => {
    respond({
      realtimeArrivalList: [row({ arvlCd: '1', barvlDt: '0' }), row({ arvlCd: '99', barvlDt: '0' })],
    });

    const snapshot = await provider().fetchNextTrains(query);

    expect(snapshot.trains.map((train) => train.arrivalInSec)).toEqual([0, null]);
  });

  describe('stale predictions', () => {
    const at = (iso: string) => jest.spyOn(Date, 'now').mockReturnValue(Date.parse(iso));

    it('subtracts the time since the data was received', async () => {
      at('2026-10-11T07:10:00Z');
      respond({ realtimeArrivalList: [row({ barvlDt: '300', recptnDt: '2026-10-11 16:07:30' })] });

      const snapshot = await provider().fetchNextTrains(query);

      expect(snapshot.trains[0].arrivalInSec).toBe(150);
    });

    it('reads the receive time as KST', async () => {
      at('2026-10-11T07:00:10Z');
      respond({ realtimeArrivalList: [row({ barvlDt: '100', recptnDt: '2026-10-11 16:00:00' })] });

      expect((await provider().fetchNextTrains(query)).trains[0].arrivalInSec).toBe(90);
    });

    it('drops a train that should have passed more than a minute ago', async () => {
      at('2026-10-11T07:10:00Z');
      respond({
        realtimeArrivalList: [
          row({ barvlDt: '140', recptnDt: '2026-10-11 16:05:00' }),
          row({ barvlDt: '140', recptnDt: '2026-10-11 16:07:40' }),
        ],
      });

      const snapshot = await provider().fetchNextTrains(query);

      expect(snapshot.trains.map((train) => train.arrivalInSec)).toEqual([0]);
    });

    it('keeps message-only predictions without a time', async () => {
      at('2026-10-11T07:10:00Z');
      respond({
        realtimeArrivalList: [row({ barvlDt: '0', arvlMsg2: '[2]번째 전역 (논현)', recptnDt: '2026-10-11 16:00:00' })],
      });

      const [train] = (await provider().fetchNextTrains(query)).trains;

      expect(train).toMatchObject({ arrivalInSec: null, message: '[2]번째 전역 (논현)' });
    });
  });

  it('skips rows without a direction or a destination', async () => {
    respond({ realtimeArrivalList: [row({ updnLine: '' }), row({ bstatnNm: '', trainLineNm: '' })] });

    expect((await provider().fetchNextTrains(query)).trains).toEqual([]);
  });

  it('does not call the API for a line the service does not cover', async () => {
    const snapshot = await provider().fetchNextTrains({ stationId: 'x', lineId: 'I1', stationName: '계양' });

    expect(snapshot.status).toBe('UNSUPPORTED_LINE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is unavailable without calling the API when the key is missing', async () => {
    const snapshot = await provider({}).fetchNextTrains(query);

    expect(snapshot.status).toBe('UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('call budget', () => {
    it('serves the same station from the cache for 30 seconds', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-11T03:00:00Z'));
      respond({ realtimeArrivalList: [row()] });
      const target = provider();

      await target.fetchNextTrains(query);
      now.mockReturnValue(Date.parse('2026-10-11T03:00:29Z'));
      await target.fetchNextTrains({ stationId: 'x', lineId: '09', stationName: '신논현' });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      now.mockReturnValue(Date.parse('2026-10-11T03:00:31Z'));
      await target.fetchNextTrains(query);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('shares one request between concurrent callers', async () => {
      respond({ realtimeArrivalList: [row()] });
      const target = provider();

      await Promise.all([
        target.fetchNextTrains(query),
        target.fetchNextTrains(query),
        target.fetchNextTrains(query),
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('serves other lines of the same station name from one request', async () => {
      respond({ realtimeArrivalList: [row(), row({ subwayId: '1077' })] });
      const target = provider();

      await target.fetchNextTrains({ stationId: 'x', lineId: '09', stationName: '신논현' });
      await target.fetchNextTrains({ stationId: 'x', lineId: 'SB', stationName: '신논현' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('stops calling the API once the daily limit is used and starts again the next KST day', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-11T03:00:00Z'));
      respond({ realtimeArrivalList: [row()] });
      const target = provider({ SEOUL_SUBWAY_REALTIME_API_KEY: 'k', SEOUL_REALTIME_DAILY_LIMIT: '2' });

      await target.fetchNextTrains({ stationId: 'x', lineId: '09', stationName: 'A' });
      await target.fetchNextTrains({ stationId: 'x', lineId: '09', stationName: 'B' });
      const blocked = await target.fetchNextTrains({ stationId: 'x', lineId: '09', stationName: 'C' });
      expect(blocked.status).toBe('UNAVAILABLE');
      expect(fetchMock).toHaveBeenCalledTimes(2);

      now.mockReturnValue(Date.parse('2026-10-11T15:30:00Z'));
      const next = await target.fetchNextTrains({ stationId: 'x', lineId: '09', stationName: 'C' });
      expect(next.status).toBe('OK');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('failures', () => {
    it('treats no data as an empty list', async () => {
      respond({ status: 500, code: 'INFO-200', message: '해당하는 데이터가 없습니다.' });

      const snapshot = await provider().fetchNextTrains(query);

      expect(snapshot.status).toBe('OK');
      expect(snapshot.trains).toEqual([]);
    });

    it('is unavailable on an error code, an HTTP error, or a network error', async () => {
      respond({ status: 500, code: 'ERROR-300' });
      expect((await provider().fetchNextTrains(query)).status).toBe('UNAVAILABLE');

      respond({}, { ok: false, status: 500 });
      expect((await provider().fetchNextTrains(query)).status).toBe('UNAVAILABLE');

      fetchMock.mockRejectedValue(new Error('timeout'));
      expect((await provider().fetchNextTrains(query)).status).toBe('UNAVAILABLE');
    });

    it('does not hammer the API after a failure', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-11T03:00:00Z'));
      fetchMock.mockRejectedValue(new Error('timeout'));
      const target = provider();

      await target.fetchNextTrains(query);
      now.mockReturnValue(Date.parse('2026-10-11T03:00:05Z'));
      await target.fetchNextTrains(query);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('never puts the API key in the logs', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED http://swopenapi.seoul.go.kr/api/subway/SECRETKEY/json'));
    const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation();

    await provider({ SEOUL_SUBWAY_REALTIME_API_KEY: 'SECRETKEY' }).fetchNextTrains(query);

    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRETKEY');
  });
});
