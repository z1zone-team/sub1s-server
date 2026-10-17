import { ConfigService } from '@nestjs/config';
import { OsrmWalkRouteProvider } from './osrm-walk-route.provider';

const FROM = { lat: 37.409, lng: 127.2528 };
const TO = { lat: 37.399907, lng: 127.25263 };

const okBody = {
  code: 'Ok',
  routes: [{ distance: 1336.3, geometry: 'abc_def' }],
  waypoints: [{ distance: 21 }, { distance: 24 }],
};

function provider(url: string | undefined) {
  const config = {
    get: jest.fn().mockReturnValue(url),
  } as unknown as ConfigService;
  return new OsrmWalkRouteProvider(config);
}

function mockFetch(impl: () => Promise<unknown>) {
  const fn = jest.fn<Promise<unknown>, [string, RequestInit?]>(impl);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const response = (body: unknown, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(body) });

describe('OsrmWalkRouteProvider', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('OSRM_URL이 없으면 호출하지 않고 null이다', async () => {
    const fetchMock = mockFetch(() => response(okBody));
    await expect(provider(undefined).route(FROM, TO)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('경도,위도 순서로 foot 프로필에 요청한다', async () => {
    const fetchMock = mockFetch(() => response(okBody));
    await provider('http://osrm:5000/').route(FROM, TO);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(
      'http://osrm:5000/route/v1/foot/127.2528,37.409;127.25263,37.399907',
    );
    expect(url).toContain('geometries=polyline');
    expect(url).toContain('overview=full');
  });

  it('거리에 보행로까지 떨어진 거리를 직선으로 더하고 경로 선을 그대로 돌려준다', async () => {
    mockFetch(() => response(okBody));
    const leg = await provider('http://osrm:5000').route(FROM, TO);
    expect(leg).toEqual({ distanceM: 1336.3 + 21 + 24, polyline: 'abc_def' });
  });

  it('가장 가까운 보행로가 500m보다 멀면 믿지 않고 null이다', async () => {
    mockFetch(() =>
      response({ ...okBody, waypoints: [{ distance: 20 }, { distance: 900 }] }),
    );
    await expect(
      provider('http://osrm:5000').route(FROM, TO),
    ).resolves.toBeNull();
  });

  it('길을 찾지 못하면 null이지만 호출을 멈추지는 않는다', async () => {
    const fetchMock = mockFetch(() => response({ code: 'NoRoute' }));
    const target = provider('http://osrm:5000');
    await expect(target.route(FROM, TO)).resolves.toBeNull();
    await target.route(FROM, TO);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('응답 형식이 맞지 않으면 null이다', async () => {
    mockFetch(() => response({ code: 'Ok', routes: [{ distance: 'x' }] }));
    await expect(
      provider('http://osrm:5000').route(FROM, TO),
    ).resolves.toBeNull();
  });

  it('서비스가 실패하면 null이고 30초 동안은 다시 부르지 않는다', async () => {
    const fetchMock = mockFetch(() =>
      Promise.reject(new Error('connect ECONNREFUSED')),
    );
    const target = provider('http://osrm:5000');
    await expect(target.route(FROM, TO)).resolves.toBeNull();
    await expect(target.route(FROM, TO)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 오류도 실패로 보고 건너뛴다', async () => {
    const fetchMock = mockFetch(() => response({}, false, 500));
    const target = provider('http://osrm:5000');
    await expect(target.route(FROM, TO)).resolves.toBeNull();
    await target.route(FROM, TO);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('30초가 지나면 다시 시도한다', async () => {
    const fetchMock = mockFetch(() => Promise.reject(new Error('down')));
    const target = provider('http://osrm:5000');
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await target.route(FROM, TO);
    now.mockReturnValue(1_000_000 + 31_000);
    await target.route(FROM, TO);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
