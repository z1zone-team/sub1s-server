import { bboxOf, buildOverpassQuery, cellsNearPoints, dedupeWays, parseOverpass, splitBbox } from './osm-railways';

describe('osm railways', () => {
  describe('bboxOf', () => {
    it('wraps the points with a margin', () => {
      const bbox = bboxOf([
        { lat: 37.5, lng: 127.0 },
        { lat: 37.0, lng: 126.5 },
      ], 0.1);

      expect(bbox.south).toBeCloseTo(36.9);
      expect(bbox.north).toBeCloseTo(37.6);
      expect(bbox.west).toBeCloseTo(126.4);
      expect(bbox.east).toBeCloseTo(127.1);
    });

    it('throws without points', () => {
      expect(() => bboxOf([])).toThrow('no points');
    });
  });

  describe('buildOverpassQuery', () => {
    it('asks for running tracks only, without yards and sidings', () => {
      const query = buildOverpassQuery({ south: 1, west: 2, north: 3, east: 4 });

      expect(query).toContain('[out:json]');
      expect(query).toContain('way["railway"~"^(subway|rail|light_rail)$"][!"service"](1,2,3,4);');
      expect(query).toContain('out geom tags;');
    });
  });

  describe('parseOverpass', () => {
    const way = { type: 'way', id: 1, geometry: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] };

    it('keeps ways that have a geometry', () => {
      expect(parseOverpass({ elements: [way, { type: 'node', id: 2 }, { type: 'way', id: 3, geometry: [] }] })).toEqual([way]);
    });

    it('returns an empty list for a cell without tracks and throws on an unexpected shape', () => {
      expect(parseOverpass({ elements: [] })).toEqual([]);
      expect(() => parseOverpass({ remark: 'runtime error' })).toThrow('unexpected Overpass response');
    });
  });

  describe('splitBbox and dedupeWays', () => {
    it('covers the whole area with cells that do not exceed it', () => {
      const cells = splitBbox({ south: 0, west: 0, north: 0.7, east: 0.5 }, 0.3);

      expect(cells).toHaveLength(6);
      expect(Math.max(...cells.map((c) => c.north))).toBeCloseTo(0.7);
      expect(Math.max(...cells.map((c) => c.east))).toBeCloseTo(0.5);
      expect(Math.min(...cells.map((c) => c.south))).toBe(0);
    });

    it('drops cells that have no station nearby', () => {
      const cells = splitBbox({ south: 0, west: 0, north: 1, east: 1 }, 0.5);

      expect(cellsNearPoints(cells, [{ lat: 0.1, lng: 0.1 }])).toEqual([cells[0]]);
      expect(cellsNearPoints(cells, [])).toEqual([]);
    });

    it('keeps one way per id', () => {
      const way = (id: number) => ({ type: 'way' as const, id, geometry: [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }] });

      expect(dedupeWays([way(1), way(2), way(1)]).map((w) => w.id)).toEqual([1, 2]);
    });
  });
});
