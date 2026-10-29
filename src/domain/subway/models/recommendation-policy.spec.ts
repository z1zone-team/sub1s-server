import { chooseRecommendation, routeFeatures } from './recommendation-policy';
import { surveyPreference, validPreference } from './preference-model';
const fast = {
  mode: 'FASTEST',
  stationIds: ['S', 'T'],
  totalDurationSec: 600,
  totalFare: 1750,
  transferCount: 0,
  totalWalkDistanceKm: 0,
  segments: [],
};
const cheap = {
  ...fast,
  mode: 'CHEAPEST',
  stationIds: ['S', 'B', 'T'],
  totalDurationSec: 660,
  totalFare: 1550,
};
it('personal fare importance changes the personal winner without changing the common winner', () => {
  expect(chooseRecommendation([fast, cheap])).toBe(fast);
  expect(
    chooseRecommendation([fast, cheap], surveyPreference(['LOW_FARE'])),
  ).toBe(cheap);
  expect(chooseRecommendation([fast, cheap])).toBe(fast);
});
it('does not use missing walk or mock congestion as good zero observations', () => {
  const option = {
    ...fast,
    totalWalkDistanceKm: undefined,
    segments: [
      {
        lineId: 'A',
        durationSec: 600,
        isExpress: false,
        congestionRate: 20,
        congestionSource: 'MOCK',
      },
    ],
  };
  expect(routeFeatures(option).walk).toBeUndefined();
  expect(routeFeatures(option).crowd).toBeUndefined();
});
it('checks the axis contract, version, finite values and observation counts', () => {
  const model = surveyPreference(['LOW_FARE']);
  expect(validPreference(model)).toBe(true);
  expect(model.vector).toHaveLength(10);
  expect(
    validPreference({ ...model, axisKeys: [...model.axisKeys].reverse() }),
  ).toBe(false);
  expect(
    validPreference({ ...model, vector: [...model.vector.slice(1), NaN] }),
  ).toBe(false);
  expect(validPreference({ ...model, confidence: Array(10).fill(2) })).toBe(
    false,
  );
});
it('prefers the route with elevator access only for users who chose the elevator preference', () => {
  const stairs = { ...fast, elevatorAccess: 0 };
  const lift = {
    ...cheap,
    totalDurationSec: 620,
    totalFare: 1750,
    elevatorAccess: 1,
  };
  expect(routeFeatures(lift).elevator).toBe(1);
  expect(routeFeatures(fast).elevator).toBeUndefined();
  expect(chooseRecommendation([stairs, lift])).toBe(stairs);
  expect(
    chooseRecommendation([stairs, lift], surveyPreference(['ELEVATOR'])),
  ).toBe(lift);
});
it('ignores the elevator axis when any candidate lacks facility data', () => {
  const lift = {
    ...cheap,
    totalDurationSec: 620,
    totalFare: 1750,
    elevatorAccess: 1,
  };
  expect(
    chooseRecommendation([fast, lift], surveyPreference(['ELEVATOR'])),
  ).toBe(fast);
});
