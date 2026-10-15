import {
  END_CAR_FACTOR,
  TRANSFER_CAR_FACTOR,
  carLocationFactor,
  leastCrowdedCar,
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
describe('칸 수가 다른 열차', () => {
  it('8칸 열차는 8개를 만들고 8번이 끝 칸이다', () => {
    const cars = predictCars(80, [], 8);

    expect(cars).toHaveLength(8);
    expect(cars[7].rate).toBeCloseTo(80 * 0.775);
    expect(cars[0].rate).toBeCloseTo(80 * 0.775);
    expect(cars[3].rate).toBeCloseTo(80);
  });

  it('2칸 열차는 두 칸 모두 끝 칸이다', () => {
    const cars = predictCars(60, [], 2);

    expect(cars.map((car) => car.carNo)).toEqual([1, 2]);
    expect(cars.every((car) => car.rate === cars[0].rate)).toBe(true);
  });
});
});

describe('leastCrowdedCar', () => {
  // 환승 계단 칸이 없으면 1번과 마지막 칸이 같은 값으로 가장 낮다
  const cars = predictCars(60);

  it('returns the car with the lowest rate', () => {
    const picked = leastCrowdedCar(
      [
        { carNo: 1, rate: 50 },
        { carNo: 2, rate: 30 },
        { carNo: 3, rate: 40 },
      ],
      'any-seed',
    );

    expect(picked?.carNo).toBe(2);
  });

  it('picks one of the tied end cars and the same one for the same seed', () => {
    const first = leastCrowdedCar(cars, '02:02_222:INNER');

    expect([1, 10]).toContain(first?.carNo);
    expect(leastCrowdedCar(cars, '02:02_222:INNER')?.carNo).toBe(first?.carNo);
  });

  it('does not always choose the same end car across stations', () => {
    const picked = new Set(
      Array.from(
        { length: 40 },
        (_, i) => leastCrowdedCar(cars, `02:02_${200 + i}:INNER`)?.carNo,
      ),
    );

    expect(picked).toEqual(new Set([1, 10]));
  });

  it('does not depend on the order of the cars', () => {
    expect(leastCrowdedCar([...cars].reverse(), 'seed')?.carNo).toBe(
      leastCrowdedCar(cars, 'seed')?.carNo,
    );
  });

  it('treats rates that differ only by rounding noise as tied', () => {
    const picked = new Set(
      Array.from(
        { length: 40 },
        (_, i) =>
          leastCrowdedCar(
            [
              { carNo: 1, rate: 30 },
              { carNo: 2, rate: 30 + 1e-12 },
              { carNo: 3, rate: 55 },
            ],
            `seed-${i}`,
          )?.carNo,
      ),
    );

    expect(picked).toEqual(new Set([1, 2]));
  });

  it('picks the only lowest car whatever the seed', () => {
    const lone = [
      { carNo: 1, rate: 40 },
      { carNo: 2, rate: 20 },
    ];

    for (let i = 0; i < 10; i += 1) {
      expect(leastCrowdedCar(lone, `seed-${i}`)?.carNo).toBe(2);
    }
  });

  it('returns undefined without cars', () => {
    expect(leastCrowdedCar([], 'seed')).toBeUndefined();
  });
});
