import { ConfigService } from '@nestjs/config';
import { SeoulTrainPositionProvider } from './seoul-train-position.provider';

describe('SeoulTrainPositionProvider', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  const provider = (values: Record<string, string> = { SEOUL_SUBWAY_REALTIME_API_KEY: 'k' }) =>
    new SeoulTrainPositionProvider(new ConfigService(values));
  const respond = (body: unknown, ok = true, status = 200) => {
    fetchMock.mockResolvedValue({ ok, status, json: async () => body });
  };
  const row = (overrides: Record<string, string> = {}) => ({
    trainNo: '3245',
    statnNm: '역삼',
    statnTnm: '성수종착',
    updnLine: '1',
    trainSttus: '0',
    directAt: '0',
    lstcarAt: '0',
    ...overrides,
  });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('supports only the lines it knows the Seoul name of', () => {
    expect(provider().supports('02')).toBe(true);
    expect(provider().supports('09')).toBe(true);
    expect(provider().supports('SB')).toBe(false);
  });

  it('asks for one line by name in a single call and maps the rows', async () => {
    respond({
      errorMessage: { code: 'INFO-000' },
      realtimePositionList: [
        row(),
        row({ trainNo: '0467', statnNm: '종각', statnTnm: '병점', updnLine: '0', trainSttus: '1', directAt: '1', lstcarAt: '1' }),
      ],
    });

    const result = await provider().fetchLine('02');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/realtimePosition/0/1000/${encodeURIComponent('2호선')}`);
    expect(result?.source).toBe('REALTIME');
    expect(result?.lineId).toBe('02');
    expect(result?.trains).toEqual([
      { trainNo: '3245', stationName: '역삼', status: 'ENTERING', direction: 'OUTER', destinationName: '성수', isExpress: false, isLastTrain: false },
      { trainNo: '0467', stationName: '종각', status: 'ARRIVED', direction: 'INNER', destinationName: '병점', isExpress: true, isLastTrain: true },
    ]);
  });

  it('calls loop lines inner or outer and the others up or down', async () => {
    respond({ errorMessage: { code: 'INFO-000' }, realtimePositionList: [row({ updnLine: '0' }), row({ trainNo: '2', updnLine: '1' })] });

    expect((await provider().fetchLine('02'))?.trains.map((t) => t.direction)).toEqual(['INNER', 'OUTER']);
    expect((await provider().fetchLine('01'))?.trains.map((t) => t.direction)).toEqual(['UP', 'DOWN']);
  });

  it('maps the status codes and treats anything else as unknown', async () => {
    respond({
      errorMessage: { code: 'INFO-000' },
      realtimePositionList: ['0', '1', '2', '3', '4', '99', ''].map((s, i) => row({ trainNo: `t${i}`, trainSttus: s })),
    });

    const statuses = (await provider().fetchLine('02'))?.trains.map((t) => t.status);

    expect(statuses).toEqual(['ENTERING', 'ARRIVED', 'DEPARTED', 'LEFT_PREVIOUS', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
  });

  it('skips rows without a train number or station', async () => {
    respond({ errorMessage: { code: 'INFO-000' }, realtimePositionList: [row({ trainNo: '' }), row({ statnNm: '' }), row()] });

    expect((await provider().fetchLine('02'))?.trains).toHaveLength(1);
  });

  it('returns an empty list when the API says there is no data (INFO-200)', async () => {
    respond({ errorMessage: { code: 'INFO-200' } });

    expect((await provider().fetchLine('02'))?.trains).toEqual([]);
  });

  it('returns null on an API error code, an HTTP error, a network error, or a missing key', async () => {
    respond({ errorMessage: { code: 'ERROR-337' } });
    expect(await provider().fetchLine('02')).toBeNull();

    respond({}, false, 500);
    expect(await provider().fetchLine('02')).toBeNull();

    fetchMock.mockRejectedValue(new Error('boom'));
    expect(await provider().fetchLine('02')).toBeNull();

    fetchMock.mockClear();
    expect(await provider({}).fetchLine('02')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call the API for a line it does not support', async () => {
    expect(await provider().fetchLine('SB')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
