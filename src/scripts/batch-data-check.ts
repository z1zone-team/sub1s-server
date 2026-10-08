import { DataAlertDispatcher } from '../infra/batch/data-alert-dispatcher';
import { DataDiffEngine } from '../infra/batch/data-diff-engine';
import { writeFileSync } from 'fs';
import { join } from 'path';

async function main(): Promise<void> {
  process.loadEnvFile?.('.env');

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const saveBaseline = args.includes('--save-baseline');
  const offlineOnly = args.includes('--offline');

  console.log('====================================================');
  console.log('   Sub1S Subway Public Data Update Batch Checker    ');
  console.log('====================================================');

  const subwayDir = join(__dirname, '../data/subway');
  const baseline = DataDiffEngine.loadBaselineSnapshot(subwayDir);

  if (saveBaseline) {
    const targetPath = join(subwayDir, 'baseline-snapshot.json');
    writeFileSync(targetPath, JSON.stringify(baseline, null, 2));
    console.log(`[INFO] Current subway data saved as baseline: ${targetPath}`);
    console.log(`[INFO] Hash: ${baseline.contentHash}`);
    console.log(`[INFO] Stations: ${baseline.summary.stationCount}, Edges: ${baseline.summary.edgeCount}, Transfers: ${baseline.summary.transferCount}`);
    return;
  }

  console.log(`[INFO] Baseline Loaded: ${baseline.summary.stationCount} stations, ${baseline.summary.edgeCount} edges, ${baseline.summary.transferCount} transfers`);
  console.log(`[INFO] Baseline Hash: ${baseline.contentHash.slice(0, 8)}...`);

  const seoulKey = process.env.SEOUL_OPEN_API_KEY;
  const apiErrors: string[] = [];
  let current = baseline;

  if (!offlineOnly && seoulKey) {
    console.log('[INFO] Probing Seoul Open API (SearchSTNBySubwayLineInfo)...');
    try {
      const url = `http://openapi.seoul.go.kr:8088/${seoulKey}/json/SearchSTNBySubwayLineInfo/1/1000/`;
      const res = await fetch(url);
      if (!res.ok) {
        apiErrors.push(`Seoul API HTTP ${res.status}: ${res.statusText}`);
      } else {
        const json = (await res.json()) as Record<string, unknown>;
        const body = json['SearchSTNBySubwayLineInfo'] as
          | { list_total_count: number; RESULT: { CODE: string }; row: Array<Record<string, unknown>> }
          | undefined;

        if (body && Array.isArray(body.row)) {
          console.log(`[INFO] Received ${body.row.length} stations from Seoul API (Total: ${body.list_total_count})`);
        } else {
          apiErrors.push('Seoul API unexpected response body format');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiErrors.push(`Seoul API probe failed: ${msg}`);
    }
  } else if (!offlineOnly) {
    console.log('[WARN] SEOUL_OPEN_API_KEY is not set. Checking local baseline data consistency.');
  }

  const diff = DataDiffEngine.compareSnapshots(baseline, current, { apiErrors });

  console.log('\n---------------- [ Diff Summary ] ----------------');
  console.log(`- Has Changes    : ${diff.hasChanges}`);
  console.log(`- Baseline Hash  : ${diff.baselineHash.slice(0, 8)}`);
  console.log(`- Current Hash   : ${diff.currentHash.slice(0, 8)}`);
  console.log(`- Station Diff   : +${diff.stationDiff.added.length} / -${diff.stationDiff.removed.length} / Renamed ${diff.stationDiff.renamed.length}`);
  console.log(`- Edge Diff      : +${diff.edgeDiff.added.length} / -${diff.edgeDiff.removed.length} / Duration changed ${diff.edgeDiff.durationChanged.length}`);
  console.log(`- Transfer Diff  : +${diff.transferDiff.added.length} / -${diff.transferDiff.removed.length} / Duration changed ${diff.transferDiff.durationChanged.length}`);
  console.log(`- Unmapped Names : ${diff.unmappedStationNames.length}`);
  console.log(`- API Errors     : ${diff.apiErrors.length}`);
  console.log('--------------------------------------------------\n');

  const webhookUrl = process.env.DATA_ALERT_WEBHOOK_URL;
  const dispatchResult = await DataAlertDispatcher.dispatch(diff, {
    webhookUrl,
    dryRun,
    force,
  });

  console.log(`[RESULT] Dispatch: ${dispatchResult.reason} (Dispatched: ${dispatchResult.dispatched})`);
  if (dispatchResult.reportPath) {
    console.log(`[RESULT] Report saved at: ${dispatchResult.reportPath}`);
  }
}

main().catch((err: unknown) => {
  console.error('[FATAL]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
