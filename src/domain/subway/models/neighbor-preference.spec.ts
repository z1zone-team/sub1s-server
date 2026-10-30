import {
  MIN_NEIGHBORS,
  applyNeighborPrior,
  meanNeighborVector,
  parseVector,
} from './neighbor-preference';
import { PREFERENCE_AXES, surveyPreference } from './preference-model';

const filled = (value: number) => PREFERENCE_AXES.map(() => value);

describe('meanNeighborVector', () => {
  it('이웃이 최소 인원보다 적으면 쓰지 않는다', () => {
    const vectors = Array.from({ length: MIN_NEIGHBORS - 1 }, () => filled(1));
    expect(meanNeighborVector(vectors)).toBeUndefined();
  });

  it('축별 평균과 이웃 수를 돌려준다', () => {
    const vectors = [filled(1), filled(1), filled(0.5), filled(0.5), filled(0)];
    const result = meanNeighborVector(vectors)!;
    expect(result.count).toBe(5);
    expect(result.mean).toEqual(filled(0.6));
  });

  it('길이가 다르거나 0~1을 벗어난 벡터는 세지 않는다', () => {
    const vectors = [
      filled(1),
      filled(1),
      filled(1),
      filled(1),
      [1, 1],
      [...filled(1).slice(1), 2],
      [...filled(1).slice(1), Number.NaN],
    ];
    expect(meanNeighborVector(vectors)).toBeUndefined();
    expect(meanNeighborVector([...vectors, filled(1)])!.count).toBe(5);
  });
});

describe('parseVector', () => {
  it('pgvector 텍스트를 숫자 배열로 바꾼다', () => {
    expect(parseVector('[0.5,1,0.25]')).toEqual([0.5, 1, 0.25]);
  });

  it('모양이 틀리면 빈 배열이다', () => {
    expect(parseVector('0.5,1')).toEqual([]);
    expect(parseVector('')).toEqual([]);
  });
});

describe('applyNeighborPrior', () => {
  it('기록이 없으면 설문값과 이웃 평균의 평균이 된다', () => {
    const survey = surveyPreference(['FAST']);
    const result = applyNeighborPrior(survey, ['FAST'], filled(0.5), 5);
    expect(result.vector[0]).toBe(0.75);
    expect(result.vector[1]).toBe(0.5);
    expect(result.neighbors).toBe(5);
  });

  it('신뢰도가 1인 축은 본인 값이 그대로 남는다', () => {
    const model = {
      ...surveyPreference([]),
      source: 'AI' as const,
      vector: filled(0.2),
      confidence: filled(1),
    };
    expect(applyNeighborPrior(model, [], filled(1), 5).vector).toEqual(
      filled(0.2),
    );
  });

  it('신뢰도에 비례해 이웃 평균의 영향이 줄어든다', () => {
    const model = {
      ...surveyPreference([]),
      source: 'AI' as const,
      confidence: filled(0.5),
    };
    expect(applyNeighborPrior(model, [], filled(1), 5).vector[0]).toBe(0.625);
  });

  it('결과는 0~1 안에 있고 입력 모델은 바뀌지 않는다', () => {
    const prefs = ['FAST', 'FEW_TRANSFERS'];
    const survey = surveyPreference(prefs);
    const before = JSON.stringify(survey);
    for (const mean of [filled(0), filled(1)]) {
      const { vector } = applyNeighborPrior(survey, prefs, mean, 5);
      expect(vector.every((x) => x >= 0 && x <= 1)).toBe(true);
    }
    expect(JSON.stringify(survey)).toBe(before);
  });
});
