import { buildTrackGraph, nearestNodes, shortestPath, simplify, trackShape } from './track-shapes';

const way = (id: number, pts: [number, number][]) => ({
  type: 'way' as const,
  id,
  geometry: pts.map(([lat, lon]) => ({ lat, lon })),
});

describe('track shapes', () => {
  // 서쪽 -> 동쪽 본선 하나와, 가운데에서 갈라져 남쪽으로 굽는 다른 선로
  const main = way(1, [[37.5, 127.0], [37.5, 127.005], [37.5, 127.01], [37.5, 127.015]]);
  const side = way(2, [[37.5, 127.005], [37.496, 127.006], [37.492, 127.008]]);

  describe('simplify', () => {
    it('removes points on a straight line and keeps a corner', () => {
      const line = [
        { lat: 37.5, lng: 127.0 },
        { lat: 37.5, lng: 127.001 },
        { lat: 37.5, lng: 127.002 },
        { lat: 37.501, lng: 127.002 },
      ];

      expect(simplify(line, 3)).toEqual([line[0], line[2], line[3]]);
    });
  });

  describe('graph and shortest path', () => {
    const graph = buildTrackGraph([main, side]);

    it('joins ways at the same coordinate and finds the path along the tracks', () => {
      const [start] = nearestNodes(graph, { lat: 37.5, lng: 127.0 }, 50, 1);
      const [end] = nearestNodes(graph, { lat: 37.492, lng: 127.008 }, 50, 1);
      const path = shortestPath(graph, start, end, 5000);

      expect(path?.map((i) => graph.points[i])).toEqual([
        { lat: 37.5, lng: 127.0 },
        { lat: 37.5, lng: 127.005 },
        { lat: 37.496, lng: 127.006 },
        { lat: 37.492, lng: 127.008 },
      ]);
    });

    it('gives up beyond the allowed length', () => {
      const [start] = nearestNodes(graph, { lat: 37.5, lng: 127.0 }, 50, 1);
      const [end] = nearestNodes(graph, { lat: 37.5, lng: 127.015 }, 50, 1);

      expect(shortestPath(graph, start, end, 100)).toBeUndefined();
    });

    it('returns candidates by distance and nothing outside the radius', () => {
      expect(nearestNodes(graph, { lat: 37.5, lng: 127.0003 }, 600, 2)).toHaveLength(2);
      expect(nearestNodes(graph, { lat: 37.5, lng: 127.0003 }, 50, 2)).toHaveLength(1);
      expect(nearestNodes(graph, { lat: 38.0, lng: 128.0 }, 50, 2)).toEqual([]);
    });
  });

  describe('trackShape', () => {
    const graph = buildTrackGraph([main, side]);

    it('follows the track between two stations and keeps the station coordinates at both ends', () => {
      const a = { lat: 37.5001, lng: 127.0 };
      const b = { lat: 37.4921, lng: 127.008 };
      const shape = trackShape(graph, a, b);

      expect(shape?.[0]).toEqual(a);
      expect(shape?.[shape.length - 1]).toEqual(b);
      expect(shape && shape.length).toBeGreaterThanOrEqual(3);
    });

    it('is undefined when a station has no track nearby', () => {
      expect(trackShape(graph, { lat: 37.6, lng: 127.0 }, { lat: 37.5, lng: 127.01 })).toBeUndefined();
    });

    it('rejects a path that strays far from the straight line between the stations', () => {
      const detour = buildTrackGraph([
        way(3, [[37.5, 127.0], [37.52, 127.0], [37.52, 127.01], [37.5, 127.01]]),
      ]);

      expect(trackShape(detour, { lat: 37.5, lng: 127.0 }, { lat: 37.5, lng: 127.01 })).toBeUndefined();
    });
  });
});
