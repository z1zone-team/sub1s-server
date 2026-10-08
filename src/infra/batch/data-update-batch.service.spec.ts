import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataUpdateBatchService } from './data-update-batch.service';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

describe('DataUpdateBatchService', () => {
  let service: DataUpdateBatchService;
  const testSnapshotDir = join(__dirname, '../../../test-service-snapshots');

  beforeEach(async () => {
    if (existsSync(testSnapshotDir)) {
      rmSync(testSnapshotDir, { recursive: true, force: true });
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataUpdateBatchService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'DATA_ALERT_WEBHOOK_URL') return undefined;
              if (key === 'SEOUL_OPEN_API_KEY') return 'test-key';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<DataUpdateBatchService>(DataUpdateBatchService);
  });

  afterAll(() => {
    if (existsSync(testSnapshotDir)) {
      rmSync(testSnapshotDir, { recursive: true, force: true });
    }
  });

  it('should retrieve valid baseline snapshot with 799 stations', () => {
    const baseline = service.getBaselineSnapshot();

    expect(baseline).toBeDefined();
    expect(baseline.summary.stationCount).toBe(799);
    expect(baseline.summary.edgeCount).toBe(1576);
    expect(baseline.summary.transferCount).toBe(361);
  });

  it('should run offline check without exceptions', async () => {
    const diff = await service.checkAndUpdate({
      offlineOnly: true,
      dryRun: true,
      snapshotDir: testSnapshotDir,
    });

    expect(diff).toBeDefined();
    expect(diff.hasChanges).toBe(false);
    expect(diff.apiErrors).toHaveLength(0);
  });

  it('should handle API network errors gracefully without crashing', async () => {
    jest.spyOn(service, 'probeSeoulStationApi').mockResolvedValueOnce({
      rows: [],
      apiErrors: ['Simulated Network Timeout'],
    });

    const diff = await service.checkAndUpdate({
      dryRun: true,
      snapshotDir: testSnapshotDir,
    });

    expect(diff.apiErrors).toContain('Simulated Network Timeout');
  });
});
