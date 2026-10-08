import { DataDiffEngine } from './data-diff-engine';
import {
  EdgeSnapshotItem,
  StationSnapshotItem,
  SubwayDataSnapshot,
  TransferSnapshotItem,
} from './data-snapshot.types';

describe('DataDiffEngine', () => {
  const mockStations: StationSnapshotItem[] = [
    {
      id: '01_133',
      name: '서울역',
      lineId: '01',
      stationCode: '133',
      lat: 37.5559,
      lng: 126.9723,
    },
    {
      id: '01_134',
      name: '남영',
      lineId: '01',
      stationCode: '134',
      lat: 37.541,
      lng: 126.9712,
    },
  ];

  const mockEdges: EdgeSnapshotItem[] = [
    {
      fromStationId: '01_133',
      toStationId: '01_134',
      durationSec: 120,
      distanceKm: 1.7,
      isExpress: false,
    },
    {
      fromStationId: '01_134',
      toStationId: '01_133',
      durationSec: 120,
      distanceKm: 1.7,
      isExpress: false,
    },
  ];

  const mockTransfers: TransferSnapshotItem[] = [
    {
      fromStationId: '01_133',
      toStationId: '04_426',
      durationSec: 180,
      isEstimated: false,
    },
  ];

  let baseline: SubwayDataSnapshot;

  beforeEach(() => {
    baseline = DataDiffEngine.createSnapshot(
      mockStations,
      mockEdges,
      mockTransfers,
    );
  });

  it('should compute deterministic SHA-256 hash regardless of item order', () => {
    const reversedStations = [...mockStations].reverse();
    const reversedEdges = [...mockEdges].reverse();
    const hash1 = DataDiffEngine.computeSnapshotHash(
      mockStations,
      mockEdges,
      mockTransfers,
    );
    const hash2 = DataDiffEngine.computeSnapshotHash(
      reversedStations,
      reversedEdges,
      mockTransfers,
    );

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('should report no changes when current snapshot equals baseline', () => {
    const current = DataDiffEngine.createSnapshot(
      [...mockStations],
      [...mockEdges],
      [...mockTransfers],
    );

    const diff = DataDiffEngine.compareSnapshots(baseline, current);

    expect(diff.hasChanges).toBe(false);
    expect(diff.baselineHash).toBe(diff.currentHash);
    expect(diff.stationDiff.added).toHaveLength(0);
    expect(diff.stationDiff.removed).toHaveLength(0);
    expect(diff.stationDiff.renamed).toHaveLength(0);
    expect(diff.edgeDiff.added).toHaveLength(0);
    expect(diff.edgeDiff.removed).toHaveLength(0);
    expect(diff.transferDiff.added).toHaveLength(0);
    expect(diff.unmappedStationNames).toHaveLength(0);
  });

  it('should detect station additions and removals', () => {
    const modifiedStations: StationSnapshotItem[] = [
      mockStations[0], // keep 서울역
      {
        id: '01_135',
        name: '용산',
        lineId: '01',
        stationCode: '135',
        lat: 37.5298,
        lng: 126.9647,
      }, // added 용산
    ]; // removed 남영

    const current = DataDiffEngine.createSnapshot(
      modifiedStations,
      mockEdges,
      mockTransfers,
    );

    const diff = DataDiffEngine.compareSnapshots(baseline, current);

    expect(diff.hasChanges).toBe(true);
    expect(diff.stationDiff.added).toHaveLength(1);
    expect(diff.stationDiff.added[0].id).toBe('01_135');
    expect(diff.stationDiff.removed).toHaveLength(1);
    expect(diff.stationDiff.removed[0].id).toBe('01_134');
  });

  it('should detect renamed stations', () => {
    const renamedStations: StationSnapshotItem[] = [
      { ...mockStations[0], name: '서울(개명)' },
      mockStations[1],
    ];

    const current = DataDiffEngine.createSnapshot(
      renamedStations,
      mockEdges,
      mockTransfers,
    );

    const diff = DataDiffEngine.compareSnapshots(baseline, current);

    expect(diff.hasChanges).toBe(true);
    expect(diff.stationDiff.renamed).toHaveLength(1);
    expect(diff.stationDiff.renamed[0]).toEqual({
      id: '01_133',
      lineId: '01',
      oldName: '서울역',
      newName: '서울(개명)',
    });
  });

  it('should detect coordinate shifts beyond threshold', () => {
    const shiftedStations: StationSnapshotItem[] = [
      mockStations[0],
      {
        ...mockStations[1],
        lat: mockStations[1].lat + 0.005, // shifted ~550m
      },
    ];

    const current = DataDiffEngine.createSnapshot(
      shiftedStations,
      mockEdges,
      mockTransfers,
    );

    const diff = DataDiffEngine.compareSnapshots(baseline, current, {
      coordinateThresholdMeters: 100,
    });

    expect(diff.hasChanges).toBe(true);
    expect(diff.stationDiff.coordinatesShifted).toHaveLength(1);
    expect(diff.stationDiff.coordinatesShifted[0].id).toBe('01_134');
    expect(
      diff.stationDiff.coordinatesShifted[0].distanceMeters,
    ).toBeGreaterThan(100);
  });

  it('should detect edge duration changes beyond threshold', () => {
    const modifiedEdges: EdgeSnapshotItem[] = [
      { ...mockEdges[0], durationSec: 150 }, // diff = 30s
      mockEdges[1],
    ];

    const current = DataDiffEngine.createSnapshot(
      mockStations,
      modifiedEdges,
      mockTransfers,
    );

    const diff = DataDiffEngine.compareSnapshots(baseline, current, {
      durationThresholdSec: 15,
    });

    expect(diff.hasChanges).toBe(true);
    expect(diff.edgeDiff.durationChanged).toHaveLength(1);
    expect(diff.edgeDiff.durationChanged[0].diffSec).toBe(30);
  });

  it('should detect transfer changes', () => {
    const modifiedTransfers: TransferSnapshotItem[] = [
      { ...mockTransfers[0], durationSec: 300 },
    ];

    const current = DataDiffEngine.createSnapshot(
      mockStations,
      mockEdges,
      modifiedTransfers,
    );

    const diff = DataDiffEngine.compareSnapshots(baseline, current);

    expect(diff.hasChanges).toBe(true);
    expect(diff.transferDiff.durationChanged).toHaveLength(1);
    expect(diff.transferDiff.durationChanged[0].newDurationSec).toBe(300);
  });

  it('should detect unmapped station names', () => {
    const unknownStations: StationSnapshotItem[] = [
      ...mockStations,
      {
        id: '99_999',
        name: '완전새로운역_미등록',
        lineId: '99',
        stationCode: '999',
        lat: 37.5,
        lng: 127.0,
      },
    ];

    const current = DataDiffEngine.createSnapshot(
      unknownStations,
      mockEdges,
      mockTransfers,
    );

    const diff = DataDiffEngine.compareSnapshots(baseline, current);

    expect(diff.unmappedStationNames).toContain('완전새로운역_미등록');
  });

  it('should load baseline snapshot from real project subway data', () => {
    const loadedBaseline = DataDiffEngine.loadBaselineSnapshot();

    expect(loadedBaseline.summary.stationCount).toBe(799);
    expect(loadedBaseline.summary.edgeCount).toBe(1576);
    expect(loadedBaseline.summary.transferCount).toBe(361);
    expect(loadedBaseline.contentHash).toBeDefined();
  });
});
