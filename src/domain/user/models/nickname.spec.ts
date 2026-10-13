import {
  isValidNickname,
  nicknameCandidate,
  normalizeNickname,
  sanitizeNickname,
} from './nickname';

describe('nickname', () => {
  describe('isValidNickname', () => {
    it.each(['내출신은리', 'metro_owl', 'a.b-c', 'ab', '탐험가_a1b2c3', 'Kim123'])(
      'accepts %s',
      (value) => {
        expect(isValidNickname(value)).toBe(true);
      },
    );

    it.each(['a', '', 'x'.repeat(21), '내 출신', 'a@b', '이름!', '<script>', 'ab\n'])(
      'rejects %j',
      (value) => {
        expect(isValidNickname(value)).toBe(false);
      },
    );

    it('accepts the boundary lengths 2 and 20', () => {
      expect(isValidNickname('ab')).toBe(true);
      expect(isValidNickname('x'.repeat(20))).toBe(true);
    });
  });

  describe('normalizeNickname', () => {
    it('trims and composes Hangul to NFC', () => {
      const decomposed = '한글'.normalize('NFD');
      expect(decomposed).not.toBe('한글');
      expect(normalizeNickname(`  ${decomposed} `)).toBe('한글');
    });
  });

  describe('nicknameCandidate', () => {
    it('uses the base as is on the first attempt', () => {
      expect(nicknameCandidate('탐험가_abc123', 0)).toBe('탐험가_abc123');
      expect(nicknameCandidate('  Kim ', 0)).toBe('Kim');
    });

    it('adds a four character hex suffix from the second attempt on', () => {
      expect(nicknameCandidate('Kim', 1, () => 0.5)).toBe('Kim_8000');
      expect(nicknameCandidate('Kim', 2, () => 0)).toBe('Kim_0000');
    });

    it('shortens a long base so the result fits the 50 character column', () => {
      const candidate = nicknameCandidate('가'.repeat(60), 1, () => 0.99999999);
      expect(candidate.length).toBeLessThanOrEqual(50);
      expect(candidate.endsWith('_ffff')).toBe(true);
    });
  });
  describe('sanitizeNickname', () => {
    it.each([
      ['수현 박', '수현_박'],
      ['John  Doe', 'John_Doe'],
      ['  내출신은리  ', '내출신은리'],
      ['metro_owl', 'metro_owl'],
      ['a.b-c', 'a.b-c'],
      ['이름!', '이름'],
      ['김 철수 (Chulsoo)', '김_철수_Chulsoo'],
    ])('%s -> %s', (input, expected) => {
      expect(sanitizeNickname(input)).toBe(expected);
    });

    it('규칙에 맞는 닉네임은 그대로 둔다', () => {
      expect(sanitizeNickname('탐험가_a1b2c3')).toBe('탐험가_a1b2c3');
    });

    it('긴 이름은 중복 방지 접미사를 붙여도 20자를 넘지 않게 줄인다', () => {
      const result = sanitizeNickname('가나다라마바사아자차카타파하가나다라마바사');

      expect(result).toBe('가나다라마바사아자차카타파하가');
      expect(isValidNickname(`${result}_a1b2`)).toBe(true);
    });

    it('줄인 끝이 구분 문자면 지운다', () => {
      expect(sanitizeNickname('가나다라마바사아자차카타파하 가')).toBe('가나다라마바사아자차카타파하');
    });

    it.each(['', '!', '  ', '@@', '가', '!!가', undefined, null])(
      '쓸 수 있는 닉네임이 안 되면 undefined이다 (%p)',
      (input) => {
        expect(sanitizeNickname(input as string | undefined | null)).toBeUndefined();
      },
    );

    it('결과는 항상 닉네임 규칙을 통과한다', () => {
      for (const input of ['수현 박', 'A B  C', '__x__y__', '한 글 이 름 이 아 주 길 어 요 정 말']) {
        const result = sanitizeNickname(input);
        expect(result === undefined || isValidNickname(result)).toBe(true);
      }
    });
  });
});
