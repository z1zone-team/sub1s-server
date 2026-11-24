import {
  PREFERENCE_AXES,
  PreferenceModel,
  surveyPreference,
} from './preference-model';

export const NEIGHBOR_LIMIT = 20;
/** 이웃이 이보다 적으면 평균이 취향이 아니라 우연이라 쓰지 않는다 */
export const MIN_NEIGHBORS = 5;
/**
 * 이웃 고르기 1단계에서 10축 L2 거리로 먼저 뽑는 후보 수.
 * 2단계에서 이 후보들을 취향 문장 임베딩의 코사인 유사도로 다시 정렬해 NEIGHBOR_LIMIT명을 고른다
 */
export const NEIGHBOR_CANDIDATE_LIMIT = 50;
/** AI 서버 취향 문장 임베딩(multilingual-e5-small)의 차원 */
export const PREFERENCE_EMBEDDING_DIMENSIONS = 384;

/** 길이가 맞고 모든 값이 유한한 임베딩만 저장하고 검색에 쓴다 */
export function validEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === PREFERENCE_EMBEDDING_DIMENSIONS &&
    value.every((x) => typeof x === 'number' && Number.isFinite(x))
  );
}

const validVector = (vector: readonly number[]): boolean =>
  vector.length === PREFERENCE_AXES.length &&
  vector.every((x) => Number.isFinite(x) && x >= 0 && x <= 1);

export function meanNeighborVector(
  vectors: readonly (readonly number[])[],
): { mean: number[]; count: number } | undefined {
  const valid = vectors.filter(validVector);
  if (valid.length < MIN_NEIGHBORS) return undefined;
  return {
    mean: PREFERENCE_AXES.map(
      (_, axis) => valid.reduce((sum, v) => sum + v[axis], 0) / valid.length,
    ),
    count: valid.length,
  };
}

/** pgvector 텍스트 `[0.5,1,...]`를 숫자 배열로 바꾼다. 모양이 틀리면 빈 배열이라 이웃에서 빠진다 */
export function parseVector(text: string): number[] {
  const body = text.trim();
  if (!body.startsWith('[') || !body.endsWith(']')) return [];
  return body
    .slice(1, -1)
    .split(',')
    .map((x) => Number(x));
}

/**
 * 설문값 대신 설문값과 이웃 평균의 평균을 시작값으로 쓴다.
 * 축별 신뢰도(선택 기록 비중)가 클수록 본인 값이 그대로 남는다
 */
export function applyNeighborPrior(
  model: PreferenceModel,
  routePrefs: readonly string[],
  neighborMean: readonly number[],
  neighbors: number,
): PreferenceModel {
  const survey = surveyPreference(routePrefs).vector;
  return {
    ...model,
    vector: model.vector.map((x, axis) => {
      const adjusted =
        x +
        ((1 - model.confidence[axis]) * (neighborMean[axis] - survey[axis])) /
          2;
      return Math.round(Math.min(1, Math.max(0, adjusted)) * 1e6) / 1e6;
    }),
    neighbors,
  };
}
