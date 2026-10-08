import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataAlertDispatcher } from './data-alert-dispatcher';
import { DataDiffEngine } from './data-diff-engine';
import {
  DataDiffResult,
  StationSnapshotItem,
  SubwayDataSnapshot,
} from './data-snapshot.types';
import {
  normalize,
  resolveDatasetName,
} from '../../scripts/lib/subway-common';

export interface BatchCheckOptions {
  forceAlert?: boolean;
  dryRun?: boolean;
  forceKric?: boolean;
  offlineOnly?: boolean;
  snapshotDir?: string;
}

@Injectable()
export class DataUpdateBatchService {
  private readonly logger = new Logger(DataUpdateBatchService.name);
  private readonly subwayDir = join(__dirname, '../../data/subway');
  private readonly rawDir = join(__dirname, '../../../data-raw');

  constructor(private readonly configService: ConfigService) {}

  /**
   * Retrieves or loads current baseline snapshot.
   */
  public getBaselineSnapshot(): SubwayDataSnapshot {
    return DataDiffEngine.loadBaselineSnapshot(this.subwayDir);
  }

  /**
   * Saves the current subway data as baseline-snapshot.json.
   */
  public saveBaselineSnapshot(): SubwayDataSnapshot {
    const snapshot = DataDiffEngine.loadBaselineSnapshot(this.subwayDir);
    const targetPath = join(this.subwayDir, 'baseline-snapshot.json');
    writeFileSync(targetPath, JSON.stringify(snapshot, null, 2));
    this.logger.log(
      `[DataUpdateBatchService] 기준선 스냅샷 저장 완료: ${targetPath} (Hash: ${snapshot.contentHash.slice(0, 8)})`,
    );
    return snapshot;
  }

  /**
   * Probes Seoul Open API SearchSTNBySubwayLineInfo to detect new or modified stations.
   */
  public async probeSeoulStationApi(
    apiKey: string,
  ): Promise<{ rows: Array<Record<string, unknown>>; apiErrors: string[] }> {
    const apiErrors: string[] = [];
    const rows: Array<Record<string, unknown>> = [];

    try {
      const url = `http://openapi.seoul.go.kr:8088/${apiKey}/json/SearchSTNBySubwayLineInfo/1/1000/`;
      const res = await fetch(url);
      if (!res.ok) {
        apiErrors.push(`Seoul API HTTP ${res.status}: ${res.statusText}`);
        return { rows, apiErrors };
      }

      const json = (await res.json()) as Record<string, unknown>;
      const body = json['SearchSTNBySubwayLineInfo'] as
        | { list_total_count: number; RESULT: { CODE: string; MESSAGE: string }; row: Array<Record<string, unknown>> }
        | undefined;

      if (!body || !Array.isArray(body.row)) {
        apiErrors.push(
          `Seoul API unexpected body format: ${JSON.stringify(json).slice(0, 100)}`,
        );
        return { rows, apiErrors };
      }

      if (body.RESULT && body.RESULT.CODE !== 'INFO-000') {
        apiErrors.push(`Seoul API Error Code: ${body.RESULT.CODE} (${body.RESULT.MESSAGE})`);
        return { rows, apiErrors };
      }

      rows.push(...body.row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiErrors.push(`Seoul API network exception: ${msg}`);
    }

    return { rows, apiErrors };
  }

  /**
   * Executes the public data check batch pipeline.
   */
  public async checkAndUpdate(
    options: BatchCheckOptions = {},
  ): Promise<DataDiffResult> {
    this.logger.log('[DataUpdateBatchService] 공공데이터 갱신 배치 검사 시작...');

    const baseline = this.getBaselineSnapshot();
    const apiErrors: string[] = [];
    let current = baseline;

    const seoulKey =
      this.configService.get<string>('SEOUL_OPEN_API_KEY') ||
      process.env.SEOUL_OPEN_API_KEY;

    // 1. External API Probing (if not offline)
    if (!options.offlineOnly && seoulKey) {
      const probeResult = await this.probeSeoulStationApi(seoulKey);
      apiErrors.push(...probeResult.apiErrors);

      if (probeResult.rows.length > 0) {
        // Construct probed station items
        const probedStations: StationSnapshotItem[] = [];
        const seenIds = new Set<string>();

        for (const r of probeResult.rows) {
          const lineNum = String(r.LINE_NUM ?? '');
          const stationNm = String(r.STATION_NM ?? '');
          const frCode = String(r.FR_CODE ?? '');
          const stationCd = String(r.STATION_CD ?? '');

          const resolvedName = resolveDatasetName(lineNum, stationNm);
          // Look up existing station in baseline to retain coords/ids if matched
          const existing = baseline.stations.find(
            (s) =>
              s.stationCode === (frCode || stationCd) ||
              (normalize(s.name) === normalize(resolvedName) && s.stationCode === stationCd),
          );

          const id = existing ? existing.id : `NEW_${lineNum}_${frCode || stationCd}`;
          if (!seenIds.has(id)) {
            seenIds.add(id);
            probedStations.push({
              id,
              name: resolvedName,
              lineId: existing ? existing.lineId : lineNum,
              stationCode: frCode || stationCd,
              lat: existing ? existing.lat : 37.5665,
              lng: existing ? existing.lng : 126.978,
            });
          }
        }

        // If probed stations count or composition changed, construct current snapshot
        if (probedStations.length > 0) {
          current = DataDiffEngine.createSnapshot(
            probedStations,
            baseline.edges,
            baseline.transfers,
          );
        }
      }
    } else if (options.offlineOnly) {
      // Check if data-raw has newer station file
      const rawFile = join(this.rawDir, 'seoul-stations-by-line.json');
      if (existsSync(rawFile)) {
        try {
          const raw = JSON.parse(readFileSync(rawFile, 'utf-8')) as Array<Record<string, unknown>>;
          if (Array.isArray(raw)) {
            this.logger.log(`[DataUpdateBatchService] 오프라인 raw 데이터(${raw.length}개) 기반 검사 진행`);
          }
        } catch {
          // Ignore parse errors in offline check
        }
      }
    }

    // 2. Diff calculation
    const diff = DataDiffEngine.compareSnapshots(baseline, current, {
      apiErrors,
    });

    // 3. Dispatch alert (webhook or logger)
    const webhookUrl =
      this.configService.get<string>('DATA_ALERT_WEBHOOK_URL') ||
      process.env.DATA_ALERT_WEBHOOK_URL;

    await DataAlertDispatcher.dispatch(diff, {
      webhookUrl,
      force: options.forceAlert,
      dryRun: options.dryRun,
      snapshotDir: options.snapshotDir,
    });

    this.logger.log(
      `[DataUpdateBatchService] 공공데이터 갱신 배치 검사 완료 (HasChanges: ${diff.hasChanges}, Errors: ${diff.apiErrors.length})`,
    );

    return diff;
  }
}
