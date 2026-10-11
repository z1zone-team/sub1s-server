import { PushProvider } from '@prisma/client';

export const SETTLEMENT_CHANNEL_ID = 'subway-settlement';
export const MAX_TOKENS_PER_USER = 10;
export const SUPPORTED_PUSH_PROVIDERS: readonly PushProvider[] = ['EXPO'];

const EXPO_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[^\]\s]+\]$/;

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
  channelId?: string;
}

export interface PushResult {
  token: string;
  ok: boolean;
  /** 기기에서 등록이 해제된 토큰이라 다시 쓸 수 없음 */
  invalidToken: boolean;
}

export interface StoredPushToken {
  token: string;
  provider: PushProvider;
}

export function isValidPushToken(provider: PushProvider, token: string): boolean {
  if (token.length > 255) return false;
  return provider === 'EXPO' ? EXPO_TOKEN_PATTERN.test(token) : false;
}
