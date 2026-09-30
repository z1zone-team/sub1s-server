import { GraphData, SubwayGraph } from './subway-graph';

const data: GraphData = {
  stations: [
    {
      id: 'T_A',
      lineId: 'T',
      stationName: '가',
      lat: 37,
      lng: 127,
      lineSeq: 1,
    },
    {
      id: 'T_B',
      lineId: 'T',
      stationName: '나',
      lat: 37.01,
      lng: 127,
      lineSeq: 2,
    },
    {
      id: 'U_B',
      lineId: 'U',
      stationName: '나',
      lat: 37.01,
      lng: 127,
      lineSeq: null,
    },
  ],
  edges: [
    {
      fromStationId: 'T_A',
      toStationId: 'T_B',
      lineId: 'T',
      direction: 'DOWN',
      isExpress: false,
      distanceKm: 1.2,
      durationSec: 100,
      isEstimated: false,
    },
    {
      fromStationId: 'T_B',
      toStationId: 'T_A',
      lineId: 'T',
      direction: 'UP',
      isExpress: false,
      distanceKm: 1.2,
      durationSec: 100,
      isEstimated: true,
    },
  ],
  transfers: [
    { fromStationId: 'T_B', toStationId: 'U_B', walkingDurationSec: 90 },
    { fromStationId: 'U_B', toStationId: 'T_B', walkingDurationSec: 90 },
  ],
};

describe('SubwayGraph', () => {
  const graph = new SubwayGraph(data);

  it('resolves station ids to dense indexes', () => {
    expect(graph.stationCount).toBe(3);
    expect(graph.indexOf('T_B')).toBe(1);
    expect(graph.indexOf('nope')).toBeUndefined();
    expect(graph.station(2).stationName).toBe('나');
  });

  it('returns the neighbors of a station by array access', () => {
    const a = graph.indexOf('T_A') as number;
    const b = graph.indexOf('T_B') as number;
    expect(graph.edgesFrom(a)).toHaveLength(1);
    expect(graph.edgesFrom(a)[0]).toMatchObject({
      toIndex: b,
      direction: 'DOWN',
      distanceKm: 1.2,
    });
    expect(graph.edgesFrom(b)[0].isEstimated).toBe(true);
  });

  it('keeps transfers separate from route edges', () => {
    const b = graph.indexOf('T_B') as number;
    const u = graph.indexOf('U_B') as number;
    expect(graph.transfersFrom(b)).toEqual([
      { toIndex: u, walkingDurationSec: 90 },
    ]);
    expect(graph.edgesFrom(u)).toHaveLength(0);
  });

  it('is immutable', () => {
    const a = graph.indexOf('T_A') as number;
    expect(Object.isFrozen(graph.edgesFrom(a))).toBe(true);
    expect(Object.isFrozen(graph.edgesFrom(a)[0])).toBe(true);
    expect(Object.isFrozen(graph.station(a))).toBe(true);
  });

  it('rejects an edge that references an unknown station', () => {
    const broken: GraphData = {
      ...data,
      edges: [{ ...data.edges[0], toStationId: 'T_X' }],
    };
    expect(() => new SubwayGraph(broken)).toThrow('unknown station id');
  });

  it('rejects duplicate station ids', () => {
    const broken: GraphData = {
      ...data,
      stations: [...data.stations, data.stations[0]],
    };
    expect(() => new SubwayGraph(broken)).toThrow('duplicate station id');
  });
});
