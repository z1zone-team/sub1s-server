export const PREFERENCE_VERSION = 'route-preference-v2';
export const PREFERENCE_AXES = [
  'time',
  'transfer',
  'crowd',
  'walk',
  'weakAc',
  'familiarRoute',
  'fare',
  'elevator',
  'stairs',
  'express',
] as const;
export type PreferenceAxis = (typeof PREFERENCE_AXES)[number];
export type ChoiceFeatures = Partial<Record<PreferenceAxis, number>>;
export interface ChoiceSnapshot {
  selected: ChoiceFeatures;
  alternatives: ChoiceFeatures[];
  routeFingerprint?: string;
}
export interface PreferenceModel {
  modelVersion: string;
  axisKeys: readonly string[];
  vector: number[];
  observationCounts: number[];
  confidence: number[];
  source: 'SURVEY' | 'AI';
  /** 이웃 평균 선호를 섞었을 때의 이웃 수. 저장하지 않고 검색 때만 붙는다 */
  neighbors?: number;
}
export const PREFERENCE_CODES: Partial<Record<PreferenceAxis, string>> = {
  time: 'FAST',
  transfer: 'FEW_TRANSFERS',
  crowd: 'UNCROWDED',
  walk: 'LESS_WALK',
  weakAc: 'WEAK_AC',
  familiarRoute: 'FAMILIAR_ROUTE',
  fare: 'LOW_FARE',
  elevator: 'ELEVATOR',
  stairs: 'AVOID_STAIRS',
  express: 'EXPRESS',
};
export function surveyPreference(
  routePrefs: readonly string[],
): PreferenceModel {
  return {
    modelVersion: PREFERENCE_VERSION,
    axisKeys: [...PREFERENCE_AXES],
    vector: PREFERENCE_AXES.map((axis) =>
      routePrefs.includes(PREFERENCE_CODES[axis] ?? '') ? 1 : 0.5,
    ),
    observationCounts: PREFERENCE_AXES.map(() => 0),
    confidence: PREFERENCE_AXES.map(() => 0),
    source: 'SURVEY',
  };
}
export function validPreference(value: unknown): value is PreferenceModel {
  if (!value || typeof value !== 'object') return false;
  const model = value as PreferenceModel;
  return (
    model.modelVersion === PREFERENCE_VERSION &&
    Array.isArray(model.axisKeys) &&
    model.axisKeys.join('|') === PREFERENCE_AXES.join('|') &&
    [model.vector, model.observationCounts, model.confidence].every(
      (xs) => Array.isArray(xs) && xs.length === 10,
    ) &&
    model.vector.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) &&
    model.confidence.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) &&
    model.observationCounts.every((x) => Number.isSafeInteger(x) && x >= 0) &&
    (model.source === 'AI' || model.source === 'SURVEY')
  );
}
export function importance(
  model: PreferenceModel,
  axis: PreferenceAxis,
): number {
  return model.vector[PREFERENCE_AXES.indexOf(axis)];
}
