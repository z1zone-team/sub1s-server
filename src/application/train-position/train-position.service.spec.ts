import { ConfigService } from '@nestjs/config';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { LineTrainPositions } from '../../domain/train-position/models/train-position';
import { ITrainPositionProvider } from '../../domain/train-position/ports/ITrainPositionProvider';
import { TrainPositionService, isOperatingHour } from './train-position.service';

describe('isOperatingHour', () => {
  it('is true from 05:00 until 01:00 KST and false from 01:00 to 05:00', () => {
    // KST = UTC + 9
    expect(isOperatingHour(new Date('2026-10-18T20:00:00Z'))).toBe(true); // 05:00
    expect(isOperatingHour(new Date('2026-10-18T03:00:00Z'))).toBe(true); // 12:00
    expect(isOperatingHour(new Date('2026-10-18T15:30:00Z'))).toBe(true); // 00:30
    expect(isOperatingHour(new Date('2026-10-18T16:00:00Z'))).toBe(false); // 01:00
    expect(isOperatingHour(new Date('2026-10-18T19:59:00Z'))).toBe(false); // 04:59
  });
});

describe('TrainPositionService', () => {
  const graph = new SubwayGraph({
    stations: [
      { id: '02_222', lineId: '02', stationName: '강남', lat: 37.5, lng: 127.02, lineSeq: 1 },
      { id: '02_221', lineId: '02', stationName: '역삼', lat: 37.5, lng: 127.03, lineSeq: 2 },
      { id: '09_925', lineId: '09', stationName: '신논현', lat: 37.5, lng: 127.02, lineSeq: 1 },
    ],
    edges: [],
    transfers: [],
  });
  const graphService = { getGraph: () => graph } as unknown as SubwayGraphService;
  const noon = new Date('2026-10-18T03:00:00Z'); // KST 12:00
  const night = new Date('2026-10-18T17:00:00Z'); // KST 02:00

  const positions = (lineId: string, observedAt: Date, stationName = '강남'): LineTrainPositions => ({
    lineId,
    source: 'REALTIME',
    observedAt,
    trains: [
      { trainNo: '1', stationName, status: 'ARRIVED', direction: 'INNER', destinationName: '성수', isExpress: false, isLastTrain: false },
    ],
  });
  const makeProvider = (overrides: Partial<ITrainPositionProvider> = {}) => {
    const provider = {
      source: 'REALTIME' as const,
      supports: jest.fn().mockReturnValue(true),
      fetchLine: jest.fn().mockImplementation(async (lineId: string) => positions(lineId, noon)),
      ...overrides,
    };
    return provider as unknown as ITrainPositionProvider & { fetchLine: jest.Mock; supports: jest.Mock };
  };
  const make = (provider: ITrainPositionProvider, values: Record<string, string> = {}) =>
    new TrainPositionService(provider, graphService, new ConfigService({ TRAIN_POSITION_ENABLED: 'true', ...values }));

  describe('settings', () => {
    it('is off by default and starts with the 2호선, 300 calls a day', () => {
      const settings = new TrainPositionService(makeProvider(), graphService, new ConfigService({})).getSettings();

      expect(settings.enabled).toBe(false);
      expect(settings.lines).toEqual(['02']);
      expect(settings.dailyBudget).toBe(300);
    });

    it('spreads the budget over the 20 operating hours: 300 calls is about every 4 minutes', () => {
      expect(make(makeProvider()).getSettings().intervalSec).toBe(240);
      expect(make(makeProvider(), { TRAIN_POSITION_DAILY_BUDGET: '1000' }).getSettings().intervalSec).toBe(72);
    });

    it('takes a configured interval but never goes below 10 seconds for the real API', () => {
      expect(make(makeProvider(), { TRAIN_POSITION_INTERVAL_SEC: '60' }).getSettings().intervalSec).toBe(60);
      expect(make(makeProvider(), { TRAIN_POSITION_INTERVAL_SEC: '2' }).getSettings().intervalSec).toBe(10);
    });

    it('lets the mock source poll fast because it makes no calls', () => {
      const mock = makeProvider({ source: 'MOCK' });

      expect(make(mock).getSettings().intervalSec).toBe(5);
      expect(make(mock, { TRAIN_POSITION_INTERVAL_SEC: '2' }).getSettings().intervalSec).toBe(2);
    });

    it('reads a comma separated line list', () => {
      expect(make(makeProvider(), { TRAIN_POSITION_LINES: ' 02, 09 ,,01' }).getSettings().lines).toEqual(['02', '09', '01']);
    });
  });

  describe('polling', () => {
    it('asks for one line per tick and goes around the configured lines', async () => {
      const provider = makeProvider();
      const service = make(provider, { TRAIN_POSITION_LINES: '02,09' });

      await service.tick(noon);
      await service.tick(noon);
      await service.tick(noon);

      expect(provider.fetchLine.mock.calls.map((call) => call[0])).toEqual(['02', '09', '02']);
    });

    it('does not call the real API outside the operating hours', async () => {
      const provider = makeProvider();

      await make(provider).tick(night);

      expect(provider.fetchLine).not.toHaveBeenCalled();
    });

    it('stops for the day once the daily budget is used and starts again the next day', async () => {
      const provider = makeProvider();
      const service = make(provider, { TRAIN_POSITION_DAILY_BUDGET: '2' });

      for (let i = 0; i < 5; i += 1) await service.tick(noon);
      expect(provider.fetchLine).toHaveBeenCalledTimes(2);

      await service.tick(new Date(noon.getTime() + 24 * 60 * 60 * 1000));
      expect(provider.fetchLine).toHaveBeenCalledTimes(3);
    });

    it('does not count mock polls against the budget or the operating hours', async () => {
      const provider = makeProvider({
        source: 'MOCK',
        fetchLine: jest.fn().mockImplementation(async (lineId: string) => ({ ...positions(lineId, night), source: 'MOCK' })),
      });
      const service = make(provider, { TRAIN_POSITION_DAILY_BUDGET: '1' });

      for (let i = 0; i < 4; i += 1) await service.tick(night);

      expect(provider.fetchLine).toHaveBeenCalledTimes(4);
    });

    it('skips a line the provider does not support without calling the API', async () => {
      const provider = makeProvider({ supports: jest.fn().mockReturnValue(false) });

      await make(provider).tick(noon);

      expect(provider.fetchLine).not.toHaveBeenCalled();
    });

    it('does not start a second poll while one is still running', async () => {
      let release: (value: LineTrainPositions | null) => void = () => undefined;
      const provider = makeProvider({
        fetchLine: jest.fn().mockImplementation(() => new Promise<LineTrainPositions | null>((resolve) => (release = resolve))),
      });
      const service = make(provider);

      const first = service.tick(noon);
      await service.tick(noon);
      release(positions('02', noon));
      await first;

      expect(provider.fetchLine).toHaveBeenCalledTimes(1);
    });

    it('keeps the previous result when a poll fails or throws', async () => {
      const provider = makeProvider();
      const service = make(provider);
      await service.tick(noon);
      provider.fetchLine.mockResolvedValueOnce(null);
      await service.tick(noon);
      provider.fetchLine.mockRejectedValueOnce(new Error('boom'));
      await service.tick(noon);

      expect(service.getLine('02', noon).status).toBe('OK');
      expect(service.getLine('02', noon).trains).toHaveLength(1);
    });
  });

  describe('getLine', () => {
    it('says the data has not been collected yet before the first poll', () => {
      expect(make(makeProvider()).getLine('02', noon)).toMatchObject({ status: 'NOT_COLLECTED', trains: [], observedAt: null, ageSec: null });
    });

    it('says a line the server does not collect is unsupported', async () => {
      const service = make(makeProvider());
      await service.tick(noon);

      expect(service.getLine('09', noon)).toMatchObject({ status: 'UNSUPPORTED_LINE', trains: [] });
    });

    it('returns the last positions with how old they are and the station id of the same line', async () => {
      const service = make(makeProvider());
      await service.tick(noon);

      const result = service.getLine('02', new Date(noon.getTime() + 95_000));

      expect(result).toMatchObject({ lineId: '02', source: 'REALTIME', status: 'OK', ageSec: 95, pollIntervalSec: 240 });
      expect(result.observedAt).toBe('2026-10-18T12:00:00.000+09:00');
      expect(result.trains[0]).toMatchObject({ trainNo: '1', stationName: '강남', stationId: '02_222', status: 'ARRIVED' });
    });

    it('gives a null station id when the station name is not on that line', async () => {
      const provider = makeProvider({
        fetchLine: jest.fn().mockResolvedValue(positions('02', noon, '없는역')),
      });
      const service = make(provider);
      await service.tick(noon);

      expect(service.getLine('02', noon).trains[0].stationId).toBeNull();
    });

    it('does not call the provider when the app reads positions', async () => {
      const provider = makeProvider();
      const service = make(provider);
      await service.tick(noon);
      provider.fetchLine.mockClear();

      for (let i = 0; i < 20; i += 1) service.getLine('02', noon);

      expect(provider.fetchLine).not.toHaveBeenCalled();
    });
  });
});
