import { OffRouteDetector } from './offroute-detector.service';

describe('OffRouteDetector', () => {
  let detector: OffRouteDetector;

  beforeEach(() => {
    detector = new OffRouteDetector();
  });

  it('returns ON_ROUTE when detected station is the current station', () => {
    const result = detector.evaluateDeviation(
      ['02_221', '02_220', '02_219'],
      '02_222',
      '02_222',
      false,
    );
    expect(result.shouldReroute).toBe(false);
    expect(result.reason).toBe('ON_ROUTE');
  });

  it('returns ON_ROUTE when detected station is an expected remaining station', () => {
    const result = detector.evaluateDeviation(
      ['02_221', '02_220', '02_219'],
      '02_222',
      '02_221',
      false,
    );
    expect(result.shouldReroute).toBe(false);
    expect(result.reason).toBe('ON_ROUTE');
  });

  it('returns CONFIRMED_OFFROUTE when detected station is not in remaining route', () => {
    const result = detector.evaluateDeviation(
      ['02_221', '02_220', '02_219'],
      '02_222',
      '02_223', // opposite direction (서초/교대 방면)
      false,
    );
    expect(result.shouldReroute).toBe(true);
    expect(result.reason).toBe('CONFIRMED_OFFROUTE');
  });

  it('returns USER_CONFIRMED immediately when isUserConfirmed is true', () => {
    const result = detector.evaluateDeviation(
      ['02_221', '02_220', '02_219'],
      '02_222',
      '02_221',
      true,
    );
    expect(result.shouldReroute).toBe(true);
    expect(result.reason).toBe('USER_CONFIRMED');
  });
});
