import { HighlightInput, computeRouteHighlights } from './route-highlight';

describe('computeRouteHighlights', () => {
  const option = (over: Partial<HighlightInput> = {}): HighlightInput => ({
    totalDurationSec: 1800,
    transferCount: 1,
    totalFare: 1500,
    averageCongestionRate: 60,
    walkSec: 300,
    hasWeakAcCar: false,
    ...over,
  });

  it('gives the comparative tags to the option that is clearly better than the others', () => {
    const result = computeRouteHighlights([
      option({
        totalDurationSec: 1500,
        transferCount: 2,
        totalFare: 1700,
        averageCongestionRate: 80,
        walkSec: 600,
      }),
      option({
        totalDurationSec: 1900,
        transferCount: 1,
        totalFare: 1500,
        averageCongestionRate: 50,
        walkSec: 200,
      }),
    ]);

    expect(result[0]).toEqual(['FASTEST']);
    expect(result[1]).toEqual([
      'FEWEST_TRANSFERS',
      'LEAST_CROWDED',
      'LEAST_WALK',
      'CHEAPEST',
    ]);
  });

  it('does not tag a difference that is smaller than the margin', () => {
    const result = computeRouteHighlights([
      option({
        totalDurationSec: 1800,
        averageCongestionRate: 60,
        walkSec: 300,
      }),
      option({
        totalDurationSec: 1840,
        averageCongestionRate: 63,
        walkSec: 330,
      }),
    ]);

    expect(result).toEqual([[], []]);
  });

  it('tags nothing comparative when every option is the same', () => {
    expect(computeRouteHighlights([option(), option(), option()])).toEqual([
      [],
      [],
      [],
    ]);
  });

  it('gives a tied best to every option that ties', () => {
    const result = computeRouteHighlights([
      option({ totalDurationSec: 1500 }),
      option({ totalDurationSec: 1500 }),
      option({ totalDurationSec: 2400 }),
    ]);

    expect(result.map((tags) => tags.includes('FASTEST'))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('tags NO_TRANSFER and WEAK_AC_CAR as facts even with a single option', () => {
    const result = computeRouteHighlights([
      option({ transferCount: 0, hasWeakAcCar: true }),
    ]);

    expect(result).toEqual([['NO_TRANSFER', 'WEAK_AC_CAR']]);
  });

  it('gives no comparative tag when there is only one option', () => {
    expect(computeRouteHighlights([option({ transferCount: 2 })])).toEqual([
      [],
    ]);
  });

  it('ignores options without congestion data when comparing congestion', () => {
    const result = computeRouteHighlights([
      option({ averageCongestionRate: null }),
      option({ averageCongestionRate: 40 }),
      option({ averageCongestionRate: 90 }),
    ]);

    expect(result.map((tags) => tags.includes('LEAST_CROWDED'))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('returns the tags in a fixed order', () => {
    const [tags] = computeRouteHighlights([
      option({
        totalDurationSec: 1000,
        transferCount: 0,
        totalFare: 1000,
        averageCongestionRate: 10,
        walkSec: 0,
        hasWeakAcCar: true,
      }),
      option({
        totalDurationSec: 2000,
        transferCount: 2,
        totalFare: 2000,
        averageCongestionRate: 90,
        walkSec: 900,
      }),
    ]);

    expect(tags).toEqual([
      'FASTEST',
      'FEWEST_TRANSFERS',
      'NO_TRANSFER',
      'LEAST_CROWDED',
      'LEAST_WALK',
      'CHEAPEST',
      'WEAK_AC_CAR',
    ]);
  });

  it('returns nothing for no options', () => {
    expect(computeRouteHighlights([])).toEqual([]);
  });

  it('tags tied minimum vertical travel only when the spread reaches 6m', () => {
    const tagsFor = (heights: number[]) =>
      computeRouteHighlights(
        heights.map((verticalTravelM) => option({ verticalTravelM })),
      ).map((tags) => tags.includes('LEAST_VERTICAL'));

    expect(tagsFor([0, 0, 6])).toEqual([true, true, false]);
    expect(tagsFor([20, 25.9])).toEqual([false, false]);
    expect(tagsFor([20, 20])).toEqual([false, false]);
    expect(tagsFor([20])).toEqual([false]);
  });

  it('tags the highest elevator coverage including tied best options', () => {
    const tagsFor = (values: number[]) =>
      computeRouteHighlights(
        values.map((elevatorAccess) => option({ elevatorAccess })),
      ).map((tags) => tags.includes('BEST_ELEVATOR_ACCESS'));

    expect(tagsFor([0, 0.5, 1, 1])).toEqual([false, false, true, true]);
    expect(tagsFor([1, 1])).toEqual([false, false]);
    expect(tagsFor([0, 0])).toEqual([false, false]);
    expect(tagsFor([1])).toEqual([false]);
  });

  it.each([undefined, null])(
    'suppresses only the axis with missing data (%s)',
    (missing) => {
      const verticalMissing = computeRouteHighlights([
        option({ verticalTravelM: 10, elevatorAccess: 1 }),
        option({ verticalTravelM: 30, elevatorAccess: 0 }),
        option({ verticalTravelM: missing, elevatorAccess: 0 }),
      ]);
      expect(
        verticalMissing.map((tags) => tags.includes('LEAST_VERTICAL')),
      ).toEqual([false, false, false]);
      expect(verticalMissing[0]).toContain('BEST_ELEVATOR_ACCESS');

      const elevatorMissing = computeRouteHighlights([
        option({ verticalTravelM: 10, elevatorAccess: 1 }),
        option({ verticalTravelM: 30, elevatorAccess: 0 }),
        option({ verticalTravelM: 30, elevatorAccess: missing }),
      ]);
      expect(
        elevatorMissing.map((tags) => tags.includes('BEST_ELEVATOR_ACCESS')),
      ).toEqual([false, false, false]);
      expect(elevatorMissing[0]).toContain('LEAST_VERTICAL');
    },
  );
});
