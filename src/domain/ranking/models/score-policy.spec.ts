import { ScorePolicy } from './score-policy';

describe('ScorePolicy', () => {
  it('calculates base distance points correctly (10 points per km)', () => {
    expect(ScorePolicy.calculateEarnedPoints(12.4, false)).toBe(124);
    expect(ScorePolicy.calculateEarnedPoints(0.8, false)).toBe(8);
  });

  it('adds 20 on-time bonus points when completed on schedule', () => {
    expect(ScorePolicy.calculateEarnedPoints(10.0, true)).toBe(120);
    expect(ScorePolicy.calculateEarnedPoints(0.5, true)).toBe(25);
  });
});
