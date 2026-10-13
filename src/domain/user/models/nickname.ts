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

/** 동기화로 들어온 이름을 닉네임으로 쓸 때 남기는 글자 수. 중복 방지 접미사(`_` + 16진 4자리)를 붙여도 20자를 넘지 않게 한다 */
export const SYNCED_NICKNAME_MAX_LENGTH = 15;

/**
 * 인증 서비스의 이름처럼 닉네임 규칙을 모르는 값을 규칙(`NICKNAME_PATTERN`)에 맞게 다듬는다.
 * 공백은 `_`로 바꾸고 허용되지 않는 글자는 지우고 길이를 줄인다. 쓸 수 있는 닉네임이 안 되면(2자 미만) undefined다
 */
export function sanitizeNickname(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const cleaned = normalizeNickname(value)
    .replace(/\s+/g, '_')
    .replace(/[^0-9A-Za-z가-힣_.-]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, SYNCED_NICKNAME_MAX_LENGTH)
    .replace(/[_.-]+$/g, '');
  return isValidNickname(cleaned) ? cleaned : undefined;
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
