import { decodePolyline, encodePolyline } from '../../../common/utils/polyline';
import { composeTrackPath, shapeKey, sliceSegmentStations } from './track-path';

const coords: Record<string, { lat: number; lng: number }> = {
  A: { lat: 37.5, lng: 127.0 },
  B: { lat: 37.5, lng: 127.01 },
  C: { lat: 37.5, lng: 127.02 },
};
const coordOf = (id: string) => coords[id];
// A -> B 는 위로 부풀어 오른 선로
const ab = encodePolyline([coords.A, { lat: 37.503, lng: 127.005 }, coords.B]);

describe('track path', () => {
  describe('shapeKey', () => {
    it('sorts the pair', () => {
      expect(shapeKey('B', 'A')).toBe('A|B');
      expect(shapeKey('A', 'B')).toBe('A|B');
    });
  });

  describe('sliceSegmentStations', () => {
    const ids = ['A', 'B', 'C', 'D', 'E'];

    it('cuts the stations of one segment and gives the next search start', () => {
      expect(sliceSegmentStations(ids, 'A', 'C')).toEqual({ ids: ['A', 'B', 'C'], next: 2 });
      expect(sliceSegmentStations(ids, 'D', 'E', 2)).toEqual({ ids: ['D', 'E'], next: 4 });
    });

    it('is undefined when a station is missing', () => {
      expect(sliceSegmentStations(ids, 'X', 'C')).toBeUndefined();
      expect(sliceSegmentStations(ids, 'C', 'A')).toBeUndefined();
    });
  });

  describe('composeTrackPath', () => {
    it('follows the shape of a pair in its own direction', () => {
      const path = composeTrackPath(['A', 'B'], { 'A|B': ab }, coordOf);

      expect(decodePolyline(path as string)[1]).toEqual({ lat: 37.503, lng: 127.005 });
    });

    it('reverses the shape when the pair is ridden the other way', () => {
      const points = decodePolyline(composeTrackPath(['B', 'A'], { 'A|B': ab }, coordOf) as string);

      expect(points[0]).toEqual(coords.B);
      expect(points[points.length - 1]).toEqual(coords.A);
    });

    it('draws a straight line for a pair without a shape and joins the pieces once at the shared station', () => {
      const points = decodePolyline(composeTrackPath(['A', 'B', 'C'], { 'A|B': ab }, coordOf) as string);

      expect(points).toEqual([coords.A, { lat: 37.503, lng: 127.005 }, coords.B, coords.C]);
    });

    it('is undefined when no pair has a shape', () => {
      expect(composeTrackPath(['A', 'B', 'C'], {}, coordOf)).toBeUndefined();
    });
  });
});
