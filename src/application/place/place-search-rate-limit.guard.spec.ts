import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlaceSearchRateLimitGuard, clientIp } from './place-search-rate-limit.guard';

describe('PlaceSearchRateLimitGuard', () => {
  const guardWith = (perMinute?: string) =>
    new PlaceSearchRateLimitGuard({
      get: (name: string) => (name === 'PLACE_SEARCH_PER_MINUTE' ? perMinute : undefined),
    } as unknown as ConfigService);

  const contextFor = (headers: Record<string, string> = {}, ip = '10.0.0.5') => {
    const setHeader = jest.fn();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers, ip }),
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;
    return { context, setHeader };
  };

  afterEach(() => jest.restoreAllMocks());

  it('allows requests up to the limit and then answers 429 with Retry-After', () => {
    const guard = guardWith('3');
    const { context, setHeader } = contextFor({ 'x-real-ip': '1.2.3.4' });

    for (let i = 0; i < 3; i += 1) expect(guard.canActivate(context)).toBe(true);

    let thrown: unknown;
    try {
      guard.canActivate(context);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ errorCode: 'TOO_MANY_REQUESTS', status: HttpStatus.TOO_MANY_REQUESTS });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^\d+$/));
  });

  it('counts each client IP on its own, using X-Real-IP set by the proxy', () => {
    const guard = guardWith('1');

    expect(guard.canActivate(contextFor({ 'x-real-ip': '1.1.1.1' }).context)).toBe(true);
    expect(guard.canActivate(contextFor({ 'x-real-ip': '2.2.2.2' }).context)).toBe(true);
    expect(() => guard.canActivate(contextFor({ 'x-real-ip': '1.1.1.1' }).context)).toThrow();
  });

  it('is not bypassed by adding an Authorization header', () => {
    const guard = guardWith('1');
    const headers = { 'x-real-ip': '1.1.1.1', authorization: 'Bearer anything' };

    expect(guard.canActivate(contextFor(headers).context)).toBe(true);
    expect(() => guard.canActivate(contextFor(headers).context)).toThrow();
  });

  it('starts a new window after a minute', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const guard = guardWith('1');
    const { context } = contextFor({ 'x-real-ip': '1.1.1.1' });

    guard.canActivate(context);
    expect(() => guard.canActivate(context)).toThrow();
    now.mockReturnValue(1_000_000 + 60_000);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('uses 60 per minute when the setting is missing or invalid', () => {
    for (const setting of [undefined, '', 'abc', '0', '-5']) {
      const guard = guardWith(setting);
      const { context } = contextFor({ 'x-real-ip': '9.9.9.9' });

      for (let i = 0; i < 60; i += 1) expect(guard.canActivate(context)).toBe(true);
      expect(() => guard.canActivate(context)).toThrow();
    }
  });

  describe('clientIp', () => {
    it('prefers X-Real-IP and falls back to the socket address', () => {
      expect(clientIp({ headers: { 'x-real-ip': ' 3.3.3.3 ' }, ip: '10.0.0.1' } as never)).toBe('3.3.3.3');
      expect(clientIp({ headers: {}, ip: '10.0.0.1' } as never)).toBe('10.0.0.1');
      expect(clientIp({ headers: {} } as never)).toBe('unknown');
    });
  });
});
