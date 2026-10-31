import { ScorePolicy } from './score-policy';

describe('ScorePolicy', () => {
  it('calculates base distance points correctly (10 points per km)', () => {
    expect(ScorePolicy.calculateEarnedPoints(12.4)).toBe(124);
    expect(ScorePolicy.calculateEarnedPoints(0.8)).toBe(8);
  });

  it('never goes below zero', () => {
    expect(ScorePolicy.calculateEarnedPoints(-1)).toBe(0);
  });
});
