import { PushProvider } from '@prisma/client';
import { MonthlySummary } from '../models/monthly-settlement';
import { PushMessage, PushResult, StoredPushToken } from '../models/push';

export const PUSH_SENDER = Symbol('PUSH_SENDER');
export const PUSH_TOKEN_REPOSITORY = Symbol('PUSH_TOKEN_REPOSITORY');
export const NOTIFICATION_SETTINGS_REPOSITORY = Symbol('NOTIFICATION_SETTINGS_REPOSITORY');
export const SETTLEMENT_LOG_REPOSITORY = Symbol('SETTLEMENT_LOG_REPOSITORY');

export interface IPushSender {
  /** 메시지와 같은 순서로 결과를 돌려준다. 실패해도 던지지 않는다 */
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

export interface RegisterPushToken {
  userId: string;
  token: string;
  provider: PushProvider;
  platform?: string;
}

export interface IPushTokenRepository {
  /** 같은 토큰이 다른 사용자에게 있었다면 지금 사용자로 옮긴다 */
  register(data: RegisterPushToken): Promise<void>;
  remove(userId: string, token: string): Promise<boolean>;
  findByUserIds(userIds: string[]): Promise<Map<string, StoredPushToken[]>>;
  deleteTokens(tokens: string[]): Promise<void>;
}

export interface NotificationSettings {
  monthlySettlement: boolean;
}

export interface INotificationSettingsRepository {
  get(userId: string): Promise<NotificationSettings>;
  update(userId: string, patch: Partial<NotificationSettings>): Promise<NotificationSettings>;
  /** 월말정산을 끈 사용자 */
  findMonthlySettlementDisabled(userIds: string[]): Promise<Set<string>>;
}

export interface ISettlementLogRepository {
  /**
   * 이번에 보낼 사용자를 정해 PROCESSING으로 기록하고 돌려준다. 기록은 보내기 전에 남긴다.
   * 기록이 없는 사용자, 실패한 사용자, 오래 PROCESSING에 멈춘 사용자(프로세스가 중간에 죽은 경우)가 대상이고
   * 이미 보낸 사용자와 시도 횟수를 다 쓴 사용자는 뺀다
   */
  claim(userIds: string[], periodKey: string): Promise<string[]>;
  markSent(userIds: string[], periodKey: string): Promise<void>;
  markFailed(userIds: string[], periodKey: string): Promise<void>;
}

export interface UserMonthlySummary extends MonthlySummary {
  userId: string;
}
