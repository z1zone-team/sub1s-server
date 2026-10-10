import { isValidNickname, nicknameCandidate, normalizeNickname } from './nickname';

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
});
