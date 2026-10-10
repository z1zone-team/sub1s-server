export const NICKNAME_PATTERN = /^[0-9A-Za-z가-힣_.-]{2,20}$/;
export const NAME_MAX_LENGTH = 30;
export const MAX_NICKNAME_ATTEMPTS = 6;

const BASE_MAX_LENGTH = 43;

export function normalizeNickname(value: string): string {
  return value.trim().normalize('NFC');
}

export function isSameNickname(a: string, b: string): boolean {
  return normalizeNickname(a).toLowerCase() === normalizeNickname(b).toLowerCase();
}

export function isValidNickname(value: string): boolean {
  return NICKNAME_PATTERN.test(value);
}

export function nicknameCandidate(
  base: string,
  attempt: number,
  random: () => number = Math.random,
): string {
  const trimmed = normalizeNickname(base).slice(0, BASE_MAX_LENGTH);
  if (attempt === 0) return trimmed;
  const suffix = Math.floor(random() * 0x10000)
    .toString(16)
    .padStart(4, '0');
  return `${trimmed}_${suffix}`;
}
