import { WalkingService } from './walking.service';
import { SubwayGraph } from '../models/subway-graph';

describe('WalkingService', () => {
  let service: WalkingService;

  beforeEach(() => {
    service = new WalkingService();
  });

  describe('haversineDistanceKm', () => {
    it('should return 0 for identical coordinates', () => {
      const dist = service.haversineDistanceKm(37.4979, 127.0276, 37.4979, 127.0276);
      expect(dist).toBe(0);
    });

    it('should accurately calculate distance between City Hall and Gangnam', () => {
      // 서울시청 (37.5665, 126.9780) <-> 강남역 (37.4979, 127.0276)
      const dist = service.haversineDistanceKm(37.5665, 126.978, 37.4979, 127.0276);
      expect(dist).toBeGreaterThan(8.5);
      expect(dist).toBeLessThan(9.2);
    });
  });

  describe('calculateWalkMetrics', () => {
    it('should calculate actual distance with 1.25 detour factor, duration, calories, and steps', () => {
      const straightKm = 1.0;
      const metrics = service.calculateWalkMetrics(straightKm);

      expect(metrics.straightDistanceKm).toBe(1.0);
      expect(metrics.actualDistanceKm).toBe(1.25);
      // (1250m / 1.2m/s) = 1042 seconds
      expect(metrics.durationSec).toBe(1042);
      // 1.25km * 65kcal = 81kcal
      expect(metrics.calories).toBe(81);
      // 1.25km * 1300 = 1625 steps
      expect(metrics.steps).toBe(1625);
    });
  });

  describe('findNearestStations', () => {
    const mockGraph = new SubwayGraph({
      stations: [
        {
          id: '0222',
          lineId: '02',
          stationName: '강남',
          lat: 37.4979,
          lng: 127.0276,
          lineSeq: 1,
        },
        {
          id: '0221',
          lineId: '02',
          stationName: '역삼',
          lat: 37.5006,
          lng: 127.0365,
          lineSeq: 2,
        },
        {
          id: '0101',
          lineId: '01',
          stationName: '수원',
          lat: 37.2657,
          lng: 127.0001,
          lineSeq: 10,
        },
      ],
      edges: [],
      transfers: [],
    });

    it('should find nearest station within radius', () => {
      // 강남역 부근 (37.4980, 127.0275)
      const nearest = service.findNearestStations(
        mockGraph,
        37.498,
        127.0275,
        1.5,
        2,
      );

      expect(nearest.length).toBeGreaterThanOrEqual(1);
      expect(nearest[0].station.stationName).toBe('강남');
      expect(nearest[0].metrics.actualDistanceKm).toBeLessThan(0.1);
    });

    it('should exclude stations beyond max radius', () => {
      // 수원역은 반경 2km 밖이므로 제외되어야 함
      const nearest = service.findNearestStations(
        mockGraph,
        37.498,
        127.0275,
        2.0,
      );

      const 수원 = nearest.find((n) => n.station.stationName === '수원');
      expect(수원).toBeUndefined();
    });
  });
});
