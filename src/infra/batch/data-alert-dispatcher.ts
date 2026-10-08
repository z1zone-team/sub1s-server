import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { DataDiffResult } from './data-snapshot.types';

export interface DispatchOptions {
  webhookUrl?: string;
  force?: boolean;
  dryRun?: boolean;
  snapshotDir?: string;
}

export interface DispatchResult {
  dispatched: boolean;
  reason: string;
  reportPath?: string;
  deduplicated?: boolean;
}

export class DataAlertDispatcher {
  private static readonly logger = new Logger(DataAlertDispatcher.name);
  private static readonly DEFAULT_SNAPSHOT_DIR = join(
    __dirname,
    '../../../data-snapshots',
  );

  /**
   * Formats a human-readable Markdown report for logger and webhook.
   */
  public static formatMarkdownReport(diff: DataDiffResult): string {
    const lines: string[] = [];

    if (!diff.hasChanges && diff.apiErrors.length === 0) {
      return `✅ [Sub1S] 공공데이터 무결성 검증 완료: 변경 사항 없음 (Hash: ${diff.currentHash.slice(0, 8)})`;
    }

    lines.push(`🚨 **[Sub1S] 공공데이터 변경 감지 경보**`);
    lines.push(`- **검사 일시**: ${diff.checkedAt}`);
    lines.push(
      `- **기준선 해시**: \`${diff.baselineHash.slice(0, 8)}\` ➡️ **현재 해시**: \`${diff.currentHash.slice(0, 8)}\``,
    );
    lines.push(
      `- **역 수**: ${diff.summary.baselineStations} ➡️ ${diff.summary.currentStations} (${diff.summary.currentStations - diff.summary.baselineStations >= 0 ? '+' : ''}${diff.summary.currentStations - diff.summary.baselineStations})`,
    );
    lines.push(
      `- **간선 수**: ${diff.summary.baselineEdges} ➡️ ${diff.summary.currentEdges} (${diff.summary.currentEdges - diff.summary.baselineEdges >= 0 ? '+' : ''}${diff.summary.currentEdges - diff.summary.baselineEdges})`,
    );
    lines.push(
      `- **환승 간선**: ${diff.summary.baselineTransfers} ➡️ ${diff.summary.currentTransfers} (${diff.summary.currentTransfers - diff.summary.baselineTransfers >= 0 ? '+' : ''}${diff.summary.currentTransfers - diff.summary.baselineTransfers})`,
    );

    // Station details
    const { stationDiff } = diff;
    if (stationDiff.added.length > 0) {
      lines.push(
        `\n**[역 추가]** ${stationDiff.added.length}건: ` +
          stationDiff.added.map((s) => `${s.name}(${s.lineId})`).join(', '),
      );
    }
    if (stationDiff.removed.length > 0) {
      lines.push(
        `\n**[역 삭제]** ${stationDiff.removed.length}건: ` +
          stationDiff.removed.map((s) => `${s.name}(${s.lineId})`).join(', '),
      );
    }
    if (stationDiff.renamed.length > 0) {
      lines.push(
        `\n**[역 개명]** ${stationDiff.renamed.length}건: ` +
          stationDiff.renamed
            .map((r) => `${r.oldName} ➡️ ${r.newName}(${r.lineId})`)
            .join(', '),
      );
    }
    if (stationDiff.coordinatesShifted.length > 0) {
      lines.push(
        `\n**[좌표 변동(50m 이상)]** ${stationDiff.coordinatesShifted.length}건: ` +
          stationDiff.coordinatesShifted
            .map((c) => `${c.name}(${c.distanceMeters}m)`)
            .join(', '),
      );
    }

    // Edge & Transfer details
    const { edgeDiff, transferDiff } = diff;
    if (edgeDiff.added.length > 0 || edgeDiff.removed.length > 0) {
      lines.push(
        `\n**[구간 간선 변동]** 추가 ${edgeDiff.added.length}건 / 삭제 ${edgeDiff.removed.length}건`,
      );
    }
    if (edgeDiff.durationChanged.length > 0) {
      lines.push(
        `\n**[구간 소요시간 변동(10초 이상)]** ${edgeDiff.durationChanged.length}건`,
      );
    }
    if (
      transferDiff.added.length > 0 ||
      transferDiff.removed.length > 0 ||
      transferDiff.durationChanged.length > 0
    ) {
      lines.push(
        `\n**[환승 도보시간 변동]** 추가 ${transferDiff.added.length}건 / 삭제 ${transferDiff.removed.length}건 / 변경 ${transferDiff.durationChanged.length}건`,
      );
    }

    // Unmapped names
    if (diff.unmappedStationNames.length > 0) {
      lines.push(
        `\n⚠️ **[주의 - 별칭 미등록 신규 역명]** ${diff.unmappedStationNames.length}건: ` +
          diff.unmappedStationNames.join(', '),
      );
    }

    // API errors
    if (diff.apiErrors.length > 0) {
      lines.push(`\n❌ **[API 수집 오류]**\n- ` + diff.apiErrors.join('\n- '));
    }

    lines.push(
      `\n💡 *주의: 자동 반영되지 않으므로 관리자가 수동 검토 후 정제 스크립트 실행이 필요합니다.*`,
    );

    return lines.join('\n');
  }

  /**
   * Builds Discord and Slack-compatible rich webhook payload.
   */
  public static buildWebhookPayload(
    diff: DataDiffResult,
  ): Record<string, unknown> {
    const textReport = this.formatMarkdownReport(diff);

    // Discord Embed
    const embedFields = [
      {
        name: '🚉 역 변동',
        value: `+${diff.stationDiff.added.length} / -${diff.stationDiff.removed.length} / 개명 ${diff.stationDiff.renamed.length}`,
        inline: true,
      },
      {
        name: '🛤️ 간선 변동',
        value: `+${diff.edgeDiff.added.length} / -${diff.edgeDiff.removed.length} / 시간 ${diff.edgeDiff.durationChanged.length}`,
        inline: true,
      },
      {
        name: '🔄 환승 변동',
        value: `+${diff.transferDiff.added.length} / -${diff.transferDiff.removed.length} / 시간 ${diff.transferDiff.durationChanged.length}`,
        inline: true,
      },
    ];

    if (diff.unmappedStationNames.length > 0) {
      embedFields.push({
        name: '⚠️ 별칭 미등록 역명',
        value: diff.unmappedStationNames.slice(0, 10).join(', '),
        inline: false,
      });
    }

    if (diff.apiErrors.length > 0) {
      embedFields.push({
        name: '❌ API 이상',
        value: diff.apiErrors.slice(0, 5).join('\n'),
        inline: false,
      });
    }

    return {
      content: diff.hasChanges
        ? '🚨 **[Sub1S] 공공데이터 변경 감지 경보**'
        : '✅ [Sub1S] 공공데이터 일치 확인',
      text: textReport, // For Slack fallback
      embeds: [
        {
          title: diff.hasChanges
            ? '공공데이터 스냅샷 변경 감지'
            : '공공데이터 무결성 검증 정상',
          color: diff.hasChanges ? 0xe6186c : 0x00a84d,
          description: diff.hasChanges
            ? '최신 공공데이터 스냅샷과 현재 베이스라인 간 차이가 감지되었습니다. 수동 검토가 필요합니다.'
            : '모든 역, 간선, 환승 데이터가 기준선과 정확히 일치합니다.',
          fields: embedFields,
          footer: {
            text: `Hash: ${diff.currentHash.slice(0, 8)} | Sub1S Data Pipeline`,
          },
          timestamp: diff.checkedAt,
        },
      ],
    };
  }

  /**
   * Dispatches the alert to Webhook / Logger and saves diff file.
   */
  public static async dispatch(
    diff: DataDiffResult,
    options: DispatchOptions = {},
  ): Promise<DispatchResult> {
    const snapshotDir = options.snapshotDir ?? this.DEFAULT_SNAPSHOT_DIR;
    mkdirSync(snapshotDir, { recursive: true });

    const lastHashFile = join(snapshotDir, 'last-alerted-hash.txt');

    // Check if there are changes or errors
    if (!diff.hasChanges && diff.apiErrors.length === 0) {
      this.logger.log(
        `[DataAlertDispatcher] 공공데이터 스냅샷 일치 확인. 변경 사항 없음 (Hash: ${diff.currentHash.slice(0, 8)}).`,
      );
      return {
        dispatched: false,
        reason: 'NO_CHANGES',
      };
    }

    // Deduplication check
    if (existsSync(lastHashFile) && !options.force) {
      const lastHash = readFileSync(lastHashFile, 'utf-8').trim();
      if (lastHash === diff.currentHash) {
        this.logger.log(
          `[DataAlertDispatcher] 동일한 변경 해시(${diff.currentHash.slice(0, 8)})에 대한 알림이 이미 발송되었습니다. 중복 발송 생략.`,
        );
        return {
          dispatched: false,
          deduplicated: true,
          reason: 'DEDUPLICATED_HASH',
        };
      }
    }

    // Save diff JSON artifact
    const timestampSlug = diff.checkedAt.replace(/[:.]/g, '-');
    const reportPath = join(snapshotDir, `diff-${timestampSlug}.json`);
    writeFileSync(reportPath, JSON.stringify(diff, null, 2));

    const markdownReport = this.formatMarkdownReport(diff);
    this.logger.warn(`[DataAlertDispatcher]\n${markdownReport}`);

    // If dry run, do not send webhook or persist last hash
    if (options.dryRun) {
      return {
        dispatched: false,
        reason: 'DRY_RUN',
        reportPath,
      };
    }

    // Dispatch webhook if URL provided
    const webhookUrl = options.webhookUrl ?? process.env.DATA_ALERT_WEBHOOK_URL;
    let webhookSuccess = false;

    if (webhookUrl) {
      try {
        const payload = this.buildWebhookPayload(diff);
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          webhookSuccess = true;
          this.logger.log(
            `[DataAlertDispatcher] 웹훅 알림 전송 성공: HTTP ${res.status}`,
          );
        } else {
          this.logger.error(
            `[DataAlertDispatcher] 웹훅 전송 실패: HTTP ${res.status} ${res.statusText}`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `[DataAlertDispatcher] 웹훅 전송 중 네트워크 예외: ${message}`,
        );
      }
    } else {
      this.logger.log(
        '[DataAlertDispatcher] DATA_ALERT_WEBHOOK_URL 미설정: 콘솔 로거로만 알림 기록됨.',
      );
    }

    // Persist last hash
    writeFileSync(lastHashFile, diff.currentHash);

    return {
      dispatched: webhookSuccess || true, // Log alert dispatched
      reason: webhookSuccess ? 'WEBHOOK_SENT' : 'LOGGED_ONLY',
      reportPath,
    };
  }
}
