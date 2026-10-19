import { decodePolyline, encodePolyline } from './polyline';

describe('polyline', () => {
  it('matches the Google sample', () => {
    expect(
      encodePolyline([
        { lat: 38.5, lng: -120.2 },
        { lat: 40.7, lng: -120.95 },
        { lat: 43.252, lng: -126.453 },
      ]),
    ).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('round-trips to the 5th decimal', () => {
    const points = [
      { lat: 37.12345, lng: 127.54321 },
      { lat: 37.1235, lng: 127.5441 },
    ];

    expect(decodePolyline(encodePolyline(points))).toEqual(points);
  });
});
