import { randomBytes } from 'node:crypto';

export const MAX_INVITE_TOKEN_ATTEMPTS = 5;

export function generateInviteToken(): string {
  return randomBytes(12).toString('base64url');
}
