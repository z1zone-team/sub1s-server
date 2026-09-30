import {
  LinePath,
  Segment,
  StationPoint,
  assignLineSeq,
  buildEdges,
  calibrate,
} from './edges';

// roughly 1.11km apart per 0.01 degree of latitude
const stations: StationPoint[] = [
  { id: 'T_A', lat: 37.0, lng: 127.0 },
  { id: 'T_B', lat: 37.01, lng: 127.0 },
  { id: 'T_C', lat: 37.02, lng: 127.0 },
  { id: 'T_D', lat: 37.03, lng: 127.0 },
];

const segments: Segment[] = [
  {
    lineId: 'T',
    fromStationId: 'T_A',
    toStationId: 'T_B',
    distanceKm: 1.2,
    durationSec: 100,
  },
  {
    lineId: 'T',
    fromStationId: 'T_B',
    toStationId: 'T_C',
    distanceKm: 1.2,
    durationSec: 100,
  },
];

describe('calibrate', () => {
  it('derives circuity and speed from measured segments', () => {
    const calibration = calibrate(segments, stations);
    expect(calibration.circuity).toBeGreaterThan(1.05);
    expect(calibration.circuity).toBeLessThan(1.12);
    expect(calibration.speedKmh).toBeCloseTo(43.2, 1);
  });

  it('throws without measured segments', () => {
    expect(() => calibrate([], stations)).toThrow();
  });
});

describe('assignLineSeq', () => {
  it('numbers stations along paths and keeps a junction number', () => {
    const paths: LinePath[] = [
      { lineId: 'T', stationIds: ['T_A', 'T_B', 'T_C'] },
      { lineId: 'T', stationIds: ['T_B', 'T_D'] },
    ];
    const seq = assignLineSeq(paths);
    expect([
      seq.get('T_A'),
      seq.get('T_B'),
      seq.get('T_C'),
      seq.get('T_D'),
    ]).toEqual([1, 2, 3, 4]);
  });
});

describe('buildEdges', () => {
  const calibration = calibrate(segments, stations);

  it('creates both directions with DOWN and UP and uses measured values', () => {
    const edges = buildEdges(
      [{ lineId: 'T', stationIds: ['T_A', 'T_B'] }],
      segments,
      stations,
      calibration,
    );
    expect(edges).toHaveLength(2);
    const down = edges.find((e) => e.fromStationId === 'T_A');
    const up = edges.find((e) => e.fromStationId === 'T_B');
    expect(down).toMatchObject({
      direction: 'DOWN',
      distanceKm: 1.2,
      durationSec: 100,
      isEstimated: false,
    });
    expect(up).toMatchObject({ direction: 'UP', isEstimated: false });
  });

  it('estimates unmeasured segments from coordinates and flags them', () => {
    const edges = buildEdges(
      [{ lineId: 'T', stationIds: ['T_C', 'T_D'] }],
      segments,
      stations,
      calibration,
    );
    const edge = edges.find((e) => e.fromStationId === 'T_C');
    expect(edge?.isEstimated).toBe(true);
    expect(edge?.distanceKm).toBeGreaterThan(1.1);
    expect(edge?.durationSec).toBeGreaterThan(0);
  });

  it('closes a loop with INNER and OUTER edges', () => {
    const edges = buildEdges(
      [{ lineId: 'T', stationIds: ['T_A', 'T_B', 'T_C'], loop: true }],
      segments,
      stations,
      calibration,
    );
    expect(edges).toHaveLength(6);
    expect(
      edges.find((e) => e.fromStationId === 'T_C' && e.toStationId === 'T_A')
        ?.direction,
    ).toBe('OUTER');
    expect(
      edges.find((e) => e.fromStationId === 'T_A' && e.toStationId === 'T_C')
        ?.direction,
    ).toBe('INNER');
  });

  it('does not duplicate an edge shared by two paths', () => {
    const paths: LinePath[] = [
      { lineId: 'T', stationIds: ['T_A', 'T_B', 'T_C'] },
      { lineId: 'T', stationIds: ['T_B', 'T_C', 'T_D'] },
    ];
    expect(buildEdges(paths, segments, stations, calibration)).toHaveLength(6);
  });

  it('uses explicit direction labels when given', () => {
    const edges = buildEdges(
      [
        {
          lineId: 'T',
          stationIds: ['T_A', 'T_B'],
          labels: { forward: 'OUTER', backward: 'INNER' },
        },
      ],
      segments,
      stations,
      calibration,
    );
    expect(edges.find((e) => e.fromStationId === 'T_A')?.direction).toBe(
      'OUTER',
    );
    expect(edges.find((e) => e.fromStationId === 'T_B')?.direction).toBe(
      'INNER',
    );
  });
});
