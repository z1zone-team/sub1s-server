import { DEFAULT_LIMITS, buildTrackGraph, nearestNodes, shortestPath, simplify, trackShape } from './track-shapes';

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

    it('returns the nearest point of each separate track and nothing outside the radius', () => {
      // 같은 선로는 점이 여러 개 가까워도 하나, 이어지지 않은 평행 선로는 따로 하나씩
      const parallel = way(9, [[37.5003, 127.0], [37.5003, 127.005]]);
      const twoTracks = buildTrackGraph([main, parallel]);
      const near = nearestNodes(twoTracks, { lat: 37.5, lng: 127.0003 }, 600, 5);

      expect(near).toHaveLength(2);
      expect(twoTracks.points[near[0]]).toEqual({ lat: 37.5, lng: 127.0 });
      expect(twoTracks.component[near[0]]).not.toBe(twoTracks.component[near[1]]);
      // 한 선로에 점이 촘촘하면 기본은 하나, perComponent로 여러 개
      const dense = buildTrackGraph([way(7, [[37.5, 127.0], [37.5, 127.0005], [37.5, 127.001], [37.5, 127.0015]])]);
      expect(nearestNodes(dense, { lat: 37.5, lng: 127.0003 }, 300, 5)).toHaveLength(1);
      expect(nearestNodes(dense, { lat: 37.5, lng: 127.0003 }, 300, 5, 3)).toHaveLength(3);
      expect(nearestNodes(graph, { lat: 38.0, lng: 128.0 }, 50, 2)).toEqual([]);
    });
  });

  describe('trackShape', () => {
    const graph = buildTrackGraph([main, side]);

    it('follows the track between two stations and starts and ends on the track, not at the station coordinate', () => {
      const a = { lat: 37.5001, lng: 127.0 };
      const b = { lat: 37.4921, lng: 127.008 };
      const shape = trackShape(graph, a, b);

      expect(shape?.[0]).toEqual({ lat: 37.5, lng: 127.0 });
      expect(shape?.[shape.length - 1]).toEqual({ lat: 37.492, lng: 127.008 });
      expect(shape && shape.length).toBeGreaterThanOrEqual(3);
    });

    it('finds the right track at a station where another line passes closer', () => {
      // 역 바로 옆에 다른 노선 선로(짧은 가지)가 더 가깝게 지나가는 경우
      const other = way(8, [[37.50005, 127.0], [37.50005, 127.0006]]);
      const mixed = buildTrackGraph([main, side, other]);
      const shape = trackShape(mixed, { lat: 37.5001, lng: 127.0 }, { lat: 37.4921, lng: 127.008 });

      expect(shape && shape.length).toBeGreaterThanOrEqual(3);
    });

    it('starts and ends at the track points nearest the stations, not at inner points that shorten the path', () => {
      const line = buildTrackGraph([way(4, [[37.5, 127.0], [37.5, 127.001], [37.5, 127.002], [37.5, 127.003], [37.5, 127.004], [37.5, 127.005]])]);
      const shape = trackShape(line, { lat: 37.5, lng: 127.0 }, { lat: 37.5, lng: 127.005 }, { ...DEFAULT_LIMITS, simplifyMeters: 0 });

      expect(shape?.[0]).toEqual({ lat: 37.5, lng: 127.0 });
      expect(shape?.[shape.length - 1]).toEqual({ lat: 37.5, lng: 127.005 });
    });

    it('crosses a small gap between two broken pieces of one track, but not a large one', () => {
      // 가운데가 약 30m 끊긴 선로(서로 다른 way라 이어져 있지 않다)
      const broken = buildTrackGraph([
        way(5, [[37.5, 127.0], [37.5, 127.004]]),
        way(6, [[37.5, 127.00435], [37.5, 127.008]]),
      ]);
      const a = { lat: 37.5, lng: 127.0 };
      const b = { lat: 37.5, lng: 127.008 };

      expect(trackShape(broken, a, b)).toBeDefined();
      expect(trackShape(broken, a, b, { ...DEFAULT_LIMITS, bridgeMeters: 0 })).toBeUndefined();

      const wide = buildTrackGraph([
        way(5, [[37.5, 127.0], [37.5, 127.004]]),
        way(6, [[37.5, 127.0052], [37.5, 127.008]]),
      ]);
      expect(trackShape(wide, a, b)).toBeUndefined();
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
