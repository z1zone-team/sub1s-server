import { scoringRoutePrefs } from './preferences';

describe('scoringRoutePrefs', () => {
  it('앉아서 가기를 고르면 덜 붐비는 경로도 고른 것으로 본다', () => {
    expect(scoringRoutePrefs(['SEAT'])).toEqual(['SEAT', 'UNCROWDED']);
  });

  it('덜 붐비는 경로를 이미 골랐으면 겹쳐 넣지 않는다', () => {
    expect(scoringRoutePrefs(['UNCROWDED', 'SEAT'])).toEqual([
      'UNCROWDED',
      'SEAT',
    ]);
  });

  it('앉아서 가기가 없으면 그대로 돌려주고 원본을 바꾸지 않는다', () => {
    const prefs = ['FAST'];
    const result = scoringRoutePrefs(prefs);
    expect(result).toEqual(['FAST']);
    expect(result).not.toBe(prefs);
  });
});
