import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  RankInfo,
  buildSettlementMessage,
  computeMonthlyRanks,
  dueSettlementPeriod,
} from '../../domain/notification/models/monthly-settlement';
import { PushMessage } from '../../domain/notification/models/push';
import {
  INotificationSettingsRepository,
  IPushSender,
  IPushTokenRepository,
  ISettlementLogRepository,
  NOTIFICATION_SETTINGS_REPOSITORY,
  PUSH_SENDER,
  PUSH_TOKEN_REPOSITORY,
  SETTLEMENT_LOG_REPOSITORY,
} from '../../domain/notification/ports/notification-ports';
import {
  IRankScoreRepository,
  RANK_SCORE_REPOSITORY,
} from '../../domain/ranking/ports/IRankScoreRepository';
import {
  ITravelLogRepository,
  TRAVEL_LOG_REPOSITORY,
} from '../../domain/travel/ports/ITravelLogRepository';

export interface SettlementReport {
  status: 'NOT_DUE' | 'DONE';
  periodKey?: string;
  /** 이동 기록이 있는 사용자 */
  active: number;
  /** 이번 실행에서 푸시를 시도한 사용자 */
  attempted: number;
  delivered: number;
  failed: number;
  removedTokens: number;
}

const EMPTY_REPORT: SettlementReport = {
  status: 'NOT_DUE',
  active: 0,
  attempted: 0,
  delivered: 0,
  failed: 0,
  removedTokens: 0,
};

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    @Inject(TRAVEL_LOG_REPOSITORY) private readonly travelLogs: ITravelLogRepository,
    @Inject(RANK_SCORE_REPOSITORY) private readonly rankScores: IRankScoreRepository,
    @Inject(PUSH_TOKEN_REPOSITORY) private readonly tokens: IPushTokenRepository,
    @Inject(NOTIFICATION_SETTINGS_REPOSITORY)
    private readonly settings: INotificationSettingsRepository,
    @Inject(SETTLEMENT_LOG_REPOSITORY) private readonly log: ISettlementLogRepository,
    @Inject(PUSH_SENDER) private readonly sender: IPushSender,
  ) {}

  async runIfDue(now: number = Date.now()): Promise<SettlementReport> {
    const period = dueSettlementPeriod(now);
    if (!period) return EMPTY_REPORT;

    const summaries = await this.travelLogs.summarizeByUser(period.start, period.end);
    const report: SettlementReport = {
      ...EMPTY_REPORT,
      status: 'DONE',
      periodKey: period.periodKey,
      active: summaries.length,
    };
    if (summaries.length === 0) return report;

    const userIds = summaries.map((summary) => summary.userId);
    const [tokensByUser, disabled] = await Promise.all([
      this.tokens.findByUserIds(userIds),
      this.settings.findMonthlySettlementDisabled(userIds),
    ]);
    const candidates = userIds.filter((id) => !disabled.has(id) && (tokensByUser.get(id)?.length ?? 0) > 0);
    const claimed = await this.log.claim(candidates, period.periodKey);
    report.attempted = claimed.length;
    if (claimed.length === 0) return report;

    const ranks = await this.ranksFor(period.periodKey);
    const messages: PushMessage[] = [];
    const ownerOf = new Map<string, string>();
    for (const summary of summaries.filter((item) => claimed.includes(item.userId))) {
      for (const stored of tokensByUser.get(summary.userId) ?? []) {
        messages.push(buildSettlementMessage(stored.token, period, summary, ranks.get(summary.userId)));
        ownerOf.set(stored.token, summary.userId);
      }
    }

    const results = await this.sender.send(messages);
    const deliveredUsers = new Set<string>();
    const invalidTokens: string[] = [];
    for (const result of results) {
      const owner = ownerOf.get(result.token);
      if (result.ok && owner) deliveredUsers.add(owner);
      if (result.invalidToken) invalidTokens.push(result.token);
    }

    const failedUsers = claimed.filter((id) => !deliveredUsers.has(id));
    await this.log.markFailed(failedUsers, period.periodKey);
    await this.tokens.deleteTokens(invalidTokens);

    report.delivered = deliveredUsers.size;
    report.failed = failedUsers.length;
    report.removedTokens = invalidTokens.length;
    this.logger.log(
      `Monthly settlement ${period.periodKey}: ${report.attempted} users, ${report.delivered} delivered, ${report.failed} failed, ${report.removedTokens} tokens removed`,
    );
    return report;
  }

  private async ranksFor(periodKey: string): Promise<Map<string, RankInfo>> {
    const leaderboard = await this.rankScores.findLeaderboard('MONTHLY', periodKey);
    return computeMonthlyRanks(
      leaderboard.map((score) => ({
        userId: score.userId,
        isPrivate: score.user?.rankingVisibility === 'PRIVATE',
      })),
    );
  }
}
