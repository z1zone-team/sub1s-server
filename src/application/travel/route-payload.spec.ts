import { parsePayloadDurationSec, parseRideSegments } from './route-payload';

describe('route-payload', () => {
  const ride = (lineId: string, distanceKm: number, durationSec: number, isExpress = false) => ({
    lineId,
    distanceKm,
    durationSec,
    isExpress,
  });

  describe('parseRideSegments', () => {
    it('returns the ride segments in order and drops walking', () => {
      const segments = parseRideSegments({
        segments: [ride('WALK', 0.3, 200), ride('09', 14.6, 1440, true), ride('03', 6.9, 900)],
      });

      expect(segments).toEqual([ride('09', 14.6, 1440, true), ride('03', 6.9, 900)]);
    });

    it('returns undefined when the payload has no segment list', () => {
      expect(parseRideSegments(undefined)).toBeUndefined();
      expect(parseRideSegments(null)).toBeUndefined();
      expect(parseRideSegments('text')).toBeUndefined();
      expect(parseRideSegments({ originStationId: '02_222' })).toBeUndefined();
      expect(parseRideSegments({ segments: 'nope' })).toBeUndefined();
    });

    it('returns an empty list when only walking was recorded', () => {
      expect(parseRideSegments({ segments: [ride('WALK', 0.4, 300)] })).toEqual([]);
    });

    it('skips malformed segments instead of failing', () => {
      const segments = parseRideSegments({
        segments: [
          null,
          'x',
          { lineId: 5, distanceKm: 1, durationSec: 1 },
          { lineId: '02', distanceKm: 'far', durationSec: 60 },
          { lineId: '02', distanceKm: 1, durationSec: Number.NaN },
          { lineId: '02', distanceKm: 1.5, durationSec: 120 },
        ],
      });

      expect(segments).toEqual([ride('02', 1.5, 120)]);
    });

    it('treats a missing isExpress flag as not express', () => {
      expect(parseRideSegments({ segments: [{ lineId: '02', distanceKm: 1, durationSec: 60 }] })).toEqual([
        ride('02', 1, 60, false),
      ]);
    });
  });

  describe('parsePayloadDurationSec', () => {
    it('reads a numeric durationSec and ignores anything else', () => {
      expect(parsePayloadDurationSec({ durationSec: 1980 })).toBe(1980);
      expect(parsePayloadDurationSec({ durationSec: '1980' })).toBeUndefined();
      expect(parsePayloadDurationSec({})).toBeUndefined();
      expect(parsePayloadDurationSec(null)).toBeUndefined();
    });
  });
});
