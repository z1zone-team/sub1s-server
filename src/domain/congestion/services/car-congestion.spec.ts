import {
  END_CAR_FACTOR,
  TRANSFER_CAR_FACTOR,
  carLocationFactor,
  predictCars,
} from './car-congestion';

describe('carLocationFactor', () => {
  it('gives the end cars the lowest factor and ordinary cars 1.0', () => {
    expect(carLocationFactor(1)).toBe(END_CAR_FACTOR);
    expect(carLocationFactor(10)).toBe(END_CAR_FACTOR);
    expect(carLocationFactor(5)).toBe(1.0);
  });

  it('gives cars next to a transfer stairway the highest factor', () => {
    expect(carLocationFactor(3, [3, 4])).toBe(TRANSFER_CAR_FACTOR);
    expect(carLocationFactor(4, [3, 4])).toBe(TRANSFER_CAR_FACTOR);
    expect(carLocationFactor(5, [3, 4])).toBe(1.0);
  });

  it('prefers the transfer factor over the end car factor', () => {
    expect(carLocationFactor(1, [1])).toBe(TRANSFER_CAR_FACTOR);
  });

  it('uses the train length for the last car', () => {
    expect(carLocationFactor(8, [], 8)).toBe(END_CAR_FACTOR);
    expect(carLocationFactor(10, [], 8)).toBe(1.0);
  });
});

describe('predictCars', () => {
  it('returns ten cars with the factor applied to the station congestion', () => {
    const cars = predictCars(60, [3, 4]);

    expect(cars).toHaveLength(10);
    expect(cars[0]).toEqual({ carNo: 1, rate: 60 * 0.775, level: '보통' });
    expect(cars[4].rate).toBe(60);
    expect(cars[2].rate).toBeCloseTo(85.5);
    expect(cars[2].level).toBe('혼잡');
  });

  it('never exceeds 100 percent', () => {
    expect(predictCars(95, [3]).every((c) => c.rate <= 100)).toBe(true);
    expect(predictCars(95, [3])[2].rate).toBe(100);
  });

  it('recommends the end cars when a station is crowded', () => {
    const cars = predictCars(80);
    const least = [...cars].sort((a, b) => a.rate - b.rate)[0];

    expect([1, 10]).toContain(least.carNo);
  });
});
