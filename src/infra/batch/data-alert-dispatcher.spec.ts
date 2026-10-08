import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { DataAlertDispatcher } from './data-alert-dispatcher';
import { DataDiffResult } from './data-snapshot.types';

describe('DataAlertDispatcher', () => {
  const testSnapshotDir = join(__dirname, '../../../test-snapshots');

  beforeEach(() => {
    if (existsSync(testSnapshotDir)) {
      rmSync(testSnapshotDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (existsSync(testSnapshotDir)) {
      rmSync(testSnapshotDir, { recursive: true, force: true });
    }
  });

  const emptyDiff: DataDiffResult = {
    hasChanges: false,
    baselineHash: 'hash1234567890',
    currentHash: 'hash1234567890',
    checkedAt: '2026-10-08T10:00:00.000Z',
    summary: {
      baselineStations: 799,
      currentStations: 799,
      baselineEdges: 1576,
      currentEdges: 1576,
      baselineTransfers: 361,
      currentTransfers: 361,
    },
    stationDiff: {
      added: [],
      removed: [],
      renamed: [],
      coordinatesShifted: [],
    },
    edgeDiff: {
      added: [],
      removed: [],
      durationChanged: [],
    },
    transferDiff: {
      added: [],
      removed: [],
      durationChanged: [],
    },
    unmappedStationNames: [],
    apiErrors: [],
  };

  const changedDiff: DataDiffResult = {
    ...emptyDiff,
    hasChanges: true,
    currentHash: 'hash9999999999',
    stationDiff: {
      added: [
        {
          id: '01_999',
          name: '신규역',
          lineId: '01',
          stationCode: '999',
          lat: 37.5,
          lng: 127.0,
        },
      ],
      removed: [],
      renamed: [
        {
          id: '01_133',
          lineId: '01',
          oldName: '서울역',
          newName: '서울역(환승)',
        },
      ],
      coordinatesShifted: [],
    },
    edgeDiff: {
      added: [],
      removed: [],
      durationChanged: [
        {
          fromStationId: '01_133',
          toStationId: '01_134',
          oldDurationSec: 120,
          newDurationSec: 150,
          diffSec: 30,
        },
      ],
    },
    unmappedStationNames: ['신규역'],
    apiErrors: ['Seoul API warning'],
  };

  it('should format clean markdown report when changes are present', () => {
    const report = DataAlertDispatcher.formatMarkdownReport(changedDiff);

    expect(report).toContain('🚨 **[Sub1S] 공공데이터 변경 감지 경보**');
    expect(report).toContain('[역 추가]');
    expect(report).toContain('신규역(01)');
    expect(report).toContain('[역 개명]');
    expect(report).toContain('서울역 ➡️ 서울역(환승)(01)');
    expect(report).toContain('[구간 소요시간 변동(10초 이상)]');
    expect(report).toContain('별칭 미등록 신규 역명');
    expect(report).toContain('Seoul API warning');
  });

  it('should format valid webhook payload with Discord/Slack embeds', () => {
    const payload = DataAlertDispatcher.buildWebhookPayload(changedDiff);

    expect(payload.content).toBe('🚨 **[Sub1S] 공공데이터 변경 감지 경보**');
    expect(payload.embeds).toBeDefined();
    const embeds = payload.embeds as Array<Record<string, unknown>>;
    expect(embeds[0].title).toBe('공공데이터 스냅샷 변경 감지');
    expect(embeds[0].color).toBe(0xe6186c);
  });

  it('should skip dispatching when there are no changes', async () => {
    const res = await DataAlertDispatcher.dispatch(emptyDiff, {
      snapshotDir: testSnapshotDir,
    });

    expect(res.dispatched).toBe(false);
    expect(res.reason).toBe('NO_CHANGES');
  });

  it('should dispatch alert and save diff file when changes exist', async () => {
    const res = await DataAlertDispatcher.dispatch(changedDiff, {
      snapshotDir: testSnapshotDir,
      dryRun: true,
    });

    expect(res.reportPath).toBeDefined();
    expect(existsSync(res.reportPath!)).toBe(true);
    expect(res.reason).toBe('DRY_RUN');
  });

  it('should deduplicate consecutive alerts with the same hash unless forced', async () => {
    // 1st dispatch
    const res1 = await DataAlertDispatcher.dispatch(changedDiff, {
      snapshotDir: testSnapshotDir,
    });
    expect(res1.reportPath).toBeDefined();

    // 2nd dispatch without force
    const res2 = await DataAlertDispatcher.dispatch(changedDiff, {
      snapshotDir: testSnapshotDir,
    });
    expect(res2.dispatched).toBe(false);
    expect(res2.deduplicated).toBe(true);
    expect(res2.reason).toBe('DEDUPLICATED_HASH');

    // 3rd dispatch with force
    const res3 = await DataAlertDispatcher.dispatch(changedDiff, {
      snapshotDir: testSnapshotDir,
      force: true,
    });
    expect(res3.dispatched).toBe(true);
  });
});
