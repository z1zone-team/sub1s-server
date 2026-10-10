import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import { WalkingService } from '../../domain/subway/services/walking.service';
import { IPlaceSearchProvider } from '../../domain/place/ports/IPlaceSearchProvider';
import { ISubwayLineRepository } from '../../domain/place/ports/ISubwayLineRepository';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { PlaceSearchQueryDto } from './dto/place-search-query.dto';
import { PlaceService } from './place.service';

describe('PlaceService', () => {
  const graph = new SubwayGraph({
    stations: [
      {
        id: '02_222',
        lineId: '02',
        stationName: '강남',
        lat: 37.4979,
        lng: 127.0276,
        lineSeq: 1,
      },
      {
        id: 'SB_D07',
        lineId: 'SB',
        stationName: '강남',
        lat: 37.4972,
        lng: 127.0282,
        lineSeq: 2,
      },
      {
        id: '09_925',
        lineId: '09',
        stationName: '신논현',
        lat: 37.5045,
        lng: 127.0252,
        lineSeq: 3,
      },
      {
        id: '07_732',
        lineId: '07',
        stationName: '논현',
        lat: 37.5111,
        lng: 127.0215,
        lineSeq: 4,
      },
      {
        id: '05_534',
        lineId: '05',
        stationName: '양평',
        lat: 37.5262,
        lng: 126.8841,
        lineSeq: 5,
      },
      {
        id: '01_133',
        lineId: '01',
        stationName: '서울역',
        lat: 37.5559,
        lng: 126.9723,
        lineSeq: 7,
      },
      {
        id: '04_426',
        lineId: '04',
        stationName: '서울역',
        lat: 37.5547,
        lng: 126.9707,
        lineSeq: 8,
      },
      {
        id: 'GA_X106',
        lineId: 'GA',
        stationName: '서울',
        lat: 37.5551,
        lng: 126.9714,
        lineSeq: 9,
      },
      {
        id: 'GJ_K140',
        lineId: 'GJ',
        stationName: '양평',
        lat: 37.4925,
        lng: 127.4917,
        lineSeq: 6,
      },
    ],
    edges: [],
    transfers: [],
  });

  const lineRepository: ISubwayLineRepository = {
    findAll: async () => [
      { id: '01', lineName: '1호선', colorHex: '#0052A4' },
      { id: '02', lineName: '2호선', colorHex: '#00A84D' },
      { id: '04', lineName: '4호선', colorHex: '#00A5DE' },
      { id: '05', lineName: '5호선', colorHex: '#996CAC' },
      { id: '07', lineName: '7호선', colorHex: '#747F00' },
      { id: '09', lineName: '9호선', colorHex: '#BDB092' },
      { id: 'GA', lineName: 'GTX-A', colorHex: '#9A6292' },
      { id: 'GJ', lineName: '경의중앙선', colorHex: '#77C4A3' },
      { id: 'SB', lineName: '신분당선', colorHex: '#D4003B' },
    ],
  };

  let provider: { search: jest.Mock };
  let service: PlaceService;

  const query = (
    overrides: Partial<PlaceSearchQueryDto>,
  ): PlaceSearchQueryDto =>
    Object.assign(new PlaceSearchQueryDto(), { limit: 10 }, overrides);

  beforeEach(async () => {
    provider = { search: jest.fn().mockResolvedValue([]) };
    service = new PlaceService(
      lineRepository,
      provider as IPlaceSearchProvider,
      { getGraph: () => graph } as unknown as SubwayGraphService,
      new WalkingService(),
    );
  });

  describe('station search', () => {
    it('returns one row per line of a transfer station, each with the full line list', async () => {
      const { items } = await service.search(query({ q: '강남' }));

      const allLines = [
        { lineId: '02', lineName: '2호선', colorHex: '#00A84D' },
        { lineId: 'SB', lineName: '신분당선', colorHex: '#D4003B' },
      ];
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        type: 'STATION',
        stationId: '02_222',
        name: '강남',
        line: allLines[0],
        lines: allLines,
      });
      expect(items[1]).toMatchObject({
        stationId: 'SB_D07',
        name: '강남',
        line: allLines[1],
        lines: allLines,
      });
    });

    it('shows the GTX-A node named 서울 as 서울역 and groups it with the other lines', async () => {
      const { items } = await service.search(query({ q: '서울역' }));

      expect(
        items.map((item) => item.type === 'STATION' && item.stationId),
      ).toEqual(['01_133', '04_426', 'GA_X106']);
      for (const item of items) {
        if (item.type !== 'STATION') throw new Error('expected a STATION item');
        expect(item.name).toBe('서울역');
        expect(item.lines.map((line) => line.lineId)).toEqual([
          '01',
          '04',
          'GA',
        ]);
      }
    });

    it('finds 서울역 without the 역 suffix as the same three rows', async () => {
      const { items } = await service.search(query({ q: '서울' }));

      expect(items).toHaveLength(3);
    });

    it('ignores a trailing 역 and whitespace in the query', async () => {
      const { items } = await service.search(query({ q: ' 강남 역' }));

      expect(items.map((item) => item.type === 'STATION' && item.name)).toEqual(
        ['강남', '강남'],
      );
    });

    it('matches only the exact station when the query ends with 역', async () => {
      const withSuffix = await service.search(query({ q: '논현역' }));
      const withoutSuffix = await service.search(query({ q: '논현' }));

      expect(
        withSuffix.items.map((item) => item.type === 'STATION' && item.name),
      ).toEqual(['논현']);
      expect(
        withoutSuffix.items.map((item) => item.type === 'STATION' && item.name),
      ).toEqual(['논현', '신논현']);
    });

    it('ranks exact match before prefix and contains matches', async () => {
      const { items } = await service.search(query({ q: '논현' }));

      expect(items.map((item) => item.type === 'STATION' && item.name)).toEqual(
        ['논현', '신논현'],
      );
    });

    it('keeps same-named stations that are far apart as separate results', async () => {
      const { items } = await service.search(query({ q: '양평' }));

      expect(
        items.map((item) => item.type === 'STATION' && item.stationId),
      ).toEqual(expect.arrayContaining(['05_534', 'GJ_K140']));
      expect(items).toHaveLength(2);
    });

    it('orders ties by distance from the given location', async () => {
      const nearGyeonggi = await service.search(
        query({ q: '양평', lat: 37.49, lng: 127.49 }),
      );
      const nearSeoul = await service.search(
        query({ q: '양평', lat: 37.52, lng: 126.89 }),
      );

      expect(nearGyeonggi.items[0]).toMatchObject({ stationId: 'GJ_K140' });
      expect(nearSeoul.items[0]).toMatchObject({ stationId: '05_534' });
    });

    it('returns no stations for a query that is only 역', async () => {
      const { items } = await service.search(query({ q: '역' }));

      expect(items).toEqual([]);
      expect(provider.search).not.toHaveBeenCalled();
    });

    it('respects the limit', async () => {
      const { items } = await service.search(query({ q: '양평', limit: 1 }));

      expect(items).toHaveLength(1);
    });
  });

  describe('place search', () => {
    it('does not call the external provider for a single character', async () => {
      await service.search(query({ q: '강' }));

      expect(provider.search).not.toHaveBeenCalled();
    });

    it('attaches the nearest station and walking info to a place', async () => {
      provider.search.mockResolvedValue([
        {
          name: '강남 교보타워',
          address: '서울 서초구 강남대로 465',
          category: '업무시설',
          lat: 37.5035,
          lng: 127.0243,
        },
      ]);

      const { items } = await service.search(query({ q: '교보타워' }));

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'PLACE',
        name: '강남 교보타워',
        address: '서울 서초구 강남대로 465',
        category: '업무시설',
        nearestStation: { stationId: '09_925', name: '신논현' },
      });
      const place = items[0];
      if (place.type !== 'PLACE') throw new Error('expected a PLACE item');
      expect(place.nearestStation.walkDistanceM).toBeGreaterThan(0);
      expect(place.nearestStation.walkDurationSec).toBeGreaterThan(0);
    });

    it('drops places whose nearest station is beyond the route search radius', async () => {
      provider.search.mockResolvedValue([
        {
          name: '먼 산장',
          address: '',
          lat: 37.8,
          lng: 127.8,
        },
      ]);

      const { items } = await service.search(query({ q: '산장' }));

      expect(items).toEqual([]);
    });

    it('drops the external duplicate of a subway station', async () => {
      provider.search.mockResolvedValue([
        { name: '강남역 2호선', address: '', lat: 37.4979, lng: 127.0276 },
        { name: '강남역(신분당선)', address: '', lat: 37.4972, lng: 127.0282 },
        { name: '강남역 롯데리아', address: '', lat: 37.4981, lng: 127.0279 },
      ]);

      const { items } = await service.search(query({ q: '강남역' }));

      const places = items.filter((item) => item.type === 'PLACE');
      expect(places.map((item) => item.name)).toEqual(['강남역 롯데리아']);
    });

    it('drops a station POI whose name has no 역 but is categorised as a railway station', async () => {
      provider.search.mockResolvedValue([
        {
          name: '논현',
          address: '서울특별시 서초구 잠원동 87-1',
          category: '철도시설 > 철도/지하철 > 일반철도역',
          lat: 37.5111,
          lng: 127.0215,
        },
        {
          name: '논현 기상관측소',
          address: '인천광역시 남동구',
          category: '중앙행정기관 > 기상청 > 기상관측소',
          lat: 37.5111,
          lng: 127.0215,
        },
      ]);

      const { items } = await service.search(query({ q: '논현' }));

      const places = items.filter((item) => item.type === 'PLACE');
      expect(places.map((item) => item.name)).toEqual(['논현 기상관측소']);
    });

    it('keeps a railway-categorised place that is not a known station', async () => {
      provider.search.mockResolvedValue([
        {
          name: '경부선 철도박물관',
          address: '',
          category: '철도시설 > 철도/지하철 > 기타',
          lat: 37.4979,
          lng: 127.0276,
        },
      ]);

      const { items } = await service.search(query({ q: '철도박물관' }));

      expect(items).toHaveLength(1);
    });

    it('collapses places with the same name and address', async () => {
      const dup = {
        name: '논현2동주민센터',
        address: '서울특별시 강남구 학동로43길 17',
        lat: 37.5045,
        lng: 127.0252,
      };
      provider.search.mockResolvedValue([
        { ...dup, category: '지방행정기관 > 동행정복지센터' },
        { ...dup, category: '지방행정기관' },
        { ...dup, address: '다른 주소' },
      ]);

      const { items } = await service.search(query({ q: '주민센터' }));

      expect(items).toHaveLength(2);
    });

    it('keeps a place whose name merely contains 역', async () => {
      provider.search.mockResolvedValue([
        { name: '역삼동 카페', address: '', lat: 37.4979, lng: 127.0276 },
      ]);

      const { items } = await service.search(query({ q: '역삼동' }));

      expect(items.map((item) => item.type === 'PLACE' && item.name)).toEqual([
        '역삼동 카페',
      ]);
    });

    it('still returns stations when the provider has nothing', async () => {
      provider.search.mockResolvedValue([]);

      const { items } = await service.search(query({ q: '강남' }));

      expect(items.map((item) => item.type)).toEqual(['STATION', 'STATION']);
    });

    it('lists stations before places', async () => {
      provider.search.mockResolvedValue([
        { name: '강남 세브란스', address: '', lat: 37.4979, lng: 127.0276 },
      ]);

      const { items } = await service.search(query({ q: '강남' }));

      expect(items.map((item) => item.type)).toEqual([
        'STATION',
        'STATION',
        'PLACE',
      ]);
    });
  });

  describe('station lookup', () => {
    it('returns line badges for each requested id in request order', async () => {
      const { items } = await service.findStations(['09_925', '02_222']);

      expect(items.map((item) => item.stationId)).toEqual(['09_925', '02_222']);
      expect(items[0].line).toEqual({
        lineId: '09',
        lineName: '9호선',
        colorHex: '#BDB092',
      });
      expect(items[0].lines.map((line) => line.lineId)).toEqual(['09']);
      expect(items[1].line.lineId).toBe('02');
      expect(items[1].lines.map((line) => line.lineId)).toEqual(['02', 'SB']);
    });

    it('shows the GTX-A node as 서울역 with all lines of the station', async () => {
      const { items } = await service.findStations(['GA_X106']);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        stationId: 'GA_X106',
        name: '서울역',
        line: { lineId: 'GA', lineName: 'GTX-A' },
      });
      expect(items[0].lines.map((line) => line.lineId)).toEqual([
        '01',
        '04',
        'GA',
      ]);
    });

    it('keeps the requested id for any node of a transfer station', async () => {
      const { items } = await service.findStations(['SB_D07']);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'STATION',
        stationId: 'SB_D07',
        name: '강남',
        line: { lineId: 'SB' },
      });
      expect(items[0].lines.map((line) => line.lineId)).toEqual(['02', 'SB']);
    });

    it('silently drops unknown ids', async () => {
      const { items } = await service.findStations([
        'NOPE_1',
        '07_732',
        'NOPE_2',
      ]);

      expect(items.map((item) => item.stationId)).toEqual(['07_732']);
    });

    it('returns an empty list when no id exists', async () => {
      expect((await service.findStations(['NOPE_1'])).items).toEqual([]);
    });

    it('returns each id once even when repeated', async () => {
      const { items } = await service.findStations(['07_732', '07_732']);

      expect(items).toHaveLength(1);
    });
  });

  describe('line loading', () => {
    it('does not read lines at startup and reads them once across requests', async () => {
      const findAll = jest.fn(lineRepository.findAll);
      const lazy = new PlaceService(
        { findAll },
        provider as IPlaceSearchProvider,
        { getGraph: () => graph } as unknown as SubwayGraphService,
        new WalkingService(),
      );
      expect(findAll).not.toHaveBeenCalled();

      await lazy.search(query({ q: '강남' }));
      await lazy.findStations(['02_222']);
      await lazy.search(query({ q: '논현' }));

      expect(findAll).toHaveBeenCalledTimes(1);
    });

    it('retries after a failed read instead of caching the failure', async () => {
      const findAll = jest
        .fn(lineRepository.findAll)
        .mockRejectedValueOnce(new Error('db down'));
      const lazy = new PlaceService(
        { findAll },
        provider as IPlaceSearchProvider,
        { getGraph: () => graph } as unknown as SubwayGraphService,
        new WalkingService(),
      );

      await expect(lazy.search(query({ q: '강남' }))).rejects.toThrow(
        'db down',
      );
      const { items } = await lazy.search(query({ q: '강남' }));

      expect(items).toHaveLength(2);
      expect(findAll).toHaveBeenCalledTimes(2);
    });
  });
});
