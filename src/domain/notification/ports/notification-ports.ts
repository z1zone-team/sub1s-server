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
  /** 이미 기록이 있는 사용자는 빼고 새로 기록한 사용자만 돌려준다. 기록은 보내기 전에 남긴다 */
  claim(userIds: string[], periodKey: string): Promise<string[]>;
  markFailed(userIds: string[], periodKey: string): Promise<void>;
}

export interface UserMonthlySummary extends MonthlySummary {
  userId: string;
}
