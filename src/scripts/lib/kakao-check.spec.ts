import { classify, stationKey } from './kakao-check';

const station = { id: 'T_1', stationName: '강남', lat: 37.4979, lng: 127.0276 };

const place = (name: string, lat: number, lng: number, code = 'SW8') => ({
  place_name: name,
  category_group_code: code,
  x: String(lng),
  y: String(lat),
});

describe('stationKey', () => {
  it('strips the line suffix, the 역 suffix, parentheses and dots', () => {
    expect(stationKey('강남역 2호선')).toBe('강남');
    expect(stationKey('전대·에버랜드역')).toBe('전대에버랜드');
    expect(stationKey('청량리(서울시립대입구)')).toBe('청량리');
    expect(stationKey('전대.에버랜드')).toBe('전대에버랜드');
  });
});

describe('classify', () => {
  it('is OK for a name match within 300m', () => {
    const result = classify(station, [place('강남역 2호선', 37.498, 127.0277)]);
    expect(result.status).toBe('OK');
    expect(result.distanceM).toBeLessThan(300);
  });

  it('flags a name match that is far away as FAR', () => {
    const result = classify(station, [place('강남역 2호선', 37.51, 127.04)]);
    expect(result.status).toBe('FAR');
  });

  it('is NOT_FOUND without a name match or without the subway category', () => {
    expect(
      classify(station, [place('역삼역 2호선', 37.4979, 127.0276)]).status,
    ).toBe('NOT_FOUND');
    expect(
      classify(station, [place('강남역 맛집', 37.4979, 127.0276, 'FD6')])
        .status,
    ).toBe('NOT_FOUND');
    expect(classify(station, []).status).toBe('NOT_FOUND');
  });

  it('picks the nearest of several places with the same station name', () => {
    const result = classify(station, [
      place('강남역 신분당선', 37.51, 127.04),
      place('강남역 2호선', 37.4979, 127.0277),
    ]);
    expect(result.status).toBe('OK');
    expect(result.placeName).toBe('강남역 2호선');
  });

  it('uses a stricter OK distance when one is given', () => {
    const near = place('강남역 2호선', 37.4979, 127.0288);

    expect(classify(station, [near]).status).toBe('OK');
    expect(classify(station, [near], 50).status).toBe('FAR');
    expect(classify(station, [near], 50).distanceM).toBeGreaterThan(50);
  });
});
