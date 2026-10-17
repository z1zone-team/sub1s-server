import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import {
  IPlaceSearchProvider,
  PLACE_SEARCH_PROVIDER,
} from '../src/domain/place/ports/IPlaceSearchProvider';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';

describe('Place reverse geocoding (e2e)', () => {
  let app: INestApplication;
  const reverse = jest.fn();

  const dataDir = resolve(__dirname, '../src/data/subway');
  const read = (name: string) => JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8'));
  const mockGraphRepository: ISubwayGraphRepository = {
    loadGraphData: async () => ({
      stations: read('stations.json'),
      edges: read('edges.json'),
      transfers: read('transfers.json'),
    }),
  };
  const provider: IPlaceSearchProvider = { search: async () => [], reverse };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SUBWAY_GRAPH_REPOSITORY)
      .useValue(mockGraphRepository)
      .overrideProvider(PLACE_SEARCH_PROVIDER)
      .useValue(provider)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => reverse.mockReset());

  const get = (query: string) => request(app.getHttpServer()).get(`/api/v1/places/reverse${query}`);

  it('주소와 가까운 역을 PLACE 항목으로 돌려준다', async () => {
    reverse.mockResolvedValue({
      name: '서울특별시 강남구 강남대로 396',
      address: '서울특별시 강남구 역삼동 814-6',
      category: '도로명주소',
    });

    const res = await get('?lat=37.4985&lng=127.0278').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      type: 'PLACE',
      name: '서울특별시 강남구 강남대로 396',
      lat: 37.4985,
      lng: 127.0278,
      nearestStation: { name: '강남' },
    });
    expect(reverse).toHaveBeenCalledWith(37.4985, 127.0278);
  });

  it('주소를 찾지 못해도 역이 가까우면 선택한 위치로 돌려준다', async () => {
    reverse.mockResolvedValue(null);

    const res = await get('?lat=37.4985&lng=127.0278').expect(200);

    expect(res.body.data).toMatchObject({ name: '선택한 위치', address: '' });
  });

  it('반경 안에 역이 없으면 422', async () => {
    const res = await get('?lat=33.4996&lng=126.5312').expect(422);

    expect(res.body.error.code).toBe('PLACE_OUT_OF_SERVICE_AREA');
    expect(reverse).not.toHaveBeenCalled();
  });

  it.each(['', '?lat=37.5', '?lat=abc&lng=127', '?lat=91&lng=127', '?lat=37.5&lng=181'])(
    '좌표가 없거나 잘못되면 400 (%s)',
    async (query) => {
      await get(query).expect(400);
      expect(reverse).not.toHaveBeenCalled();
    },
  );
});
