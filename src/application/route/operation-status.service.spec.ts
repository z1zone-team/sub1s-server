import { OperationNotice } from '../../domain/operation/models/operation-status';
import { IOperationNoticeProvider } from '../../domain/operation/ports/IOperationNoticeProvider';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import { SubwayRouteOptionDto } from './dto/route-search-response.dto';
import { OperationStatusService } from './operation-status.service';

describe('OperationStatusService', () => {
  const NOW = Date.parse('2026-10-11T12:00:00+09:00');
  const graph = new SubwayGraph({
    stations: [
      { id: '02_240', lineId: '02', stationName: '충정로', lat: 37.56, lng: 126.96, lineSeq: 1 },
      { id: '02_241', lineId: '02', stationName: '이대', lat: 37.557, lng: 126.946, lineSeq: 2 },
      { id: '02_242', lineId: '02', stationName: '신촌', lat: 37.555, lng: 126.936, lineSeq: 3 },
      { id: '02_243', lineId: '02', stationName: '홍대입구', lat: 37.557, lng: 126.924, lineSeq: 4 },
      { id: '09_925', lineId: '09', stationName: '신논현', lat: 37.504, lng: 127.025, lineSeq: 1 },
      { id: '09_926', lineId: '09', stationName: '고속터미널', lat: 37.505, lng: 127.004, lineSeq: 2 },
    ],
    edges: [],
    transfers: [],
  });

  const notice = (title: string, minutesAgo: number, over: Partial<OperationNotice> = {}): OperationNotice => ({
    title,
    occurredAt: NOW - minutesAgo * 60_000,
    categoryCode: '4',
    lineIds: ['02'],
    ...over,
  });

  const segment = (lineId: string, fromStationId: string, toStationId: string) =>
    ({
      lineId,
      fromStationId,
      toStationId,
      operationStatus: 'UNKNOWN',
    }) as unknown as SubwayRouteOptionDto['segments'][number];

  const option = (segments: SubwayRouteOptionDto['segments'], stationIds?: string[]) =>
    ({ mode: 'OPTIMAL', segments, stationIds, operationStatus: 'UNKNOWN' }) as unknown as SubwayRouteOptionDto;

  const walk = () => segment('WALK', 'ORIGIN_COORDINATE', '02_240');

  let fetchRecentNotices: jest.Mock;
  let service: OperationStatusService;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    fetchRecentNotices = jest.fn().mockResolvedValue([]);
    service = new OperationStatusService({ fetchRecentNotices } as unknown as IOperationNoticeProvider);
  });

  afterEach(() => jest.restoreAllMocks());

  it('marks a route NORMAL when there is no notice on its lines', async () => {
    const route = option([segment('02', '02_240', '02_243')], ['02_240', '02_241', '02_242', '02_243']);

    await service.annotate([route], graph);

    expect(route.segments[0].operationStatus).toBe('NORMAL');
    expect(route.operationStatus).toBe('NORMAL');
    expect(route.operationNotice).toBeUndefined();
  });

  it('marks the segment and the route DISRUPTED with the notice when the ride passes the affected station', async () => {
    fetchRecentNotices.mockResolvedValue([notice('2호선 이대역 안전문장애로 열차 무정차 통과중', 40)]);
    const route = option([segment('02', '02_240', '02_243')], ['02_240', '02_241', '02_242', '02_243']);

    await service.annotate([route], graph);

    expect(route.segments[0].operationStatus).toBe('DISRUPTED');
    expect(route.segments[0].operationNotice).toEqual({
      title: '2호선 이대역 안전문장애로 열차 무정차 통과중',
      occurredAt: '2026-10-11T11:20:00.000+09:00',
    });
    expect(route.operationStatus).toBe('DISRUPTED');
    expect(route.operationNotice?.title).toContain('이대역');
  });

  it('keeps a ride NORMAL when the affected station is not between its stops', async () => {
    fetchRecentNotices.mockResolvedValue([notice('2호선 이대역 무정차 통과중', 40)]);
    const route = option([segment('02', '02_242', '02_243')], ['02_242', '02_243']);

    await service.annotate([route], graph);

    expect(route.segments[0].operationStatus).toBe('NORMAL');
  });

  it('uses the stations between the stops of each ride when a route has several segments', async () => {
    fetchRecentNotices.mockResolvedValue([notice('2호선 이대역 무정차 통과중', 40)]);
    const route = option(
      [segment('09', '09_925', '09_926'), segment('02', '02_240', '02_243')],
      ['09_925', '09_926', '02_240', '02_241', '02_242', '02_243'],
    );

    await service.annotate([route], graph);

    expect(route.segments.map((s) => s.operationStatus)).toEqual(['UNKNOWN', 'DISRUPTED']);
    expect(route.operationStatus).toBe('DISRUPTED');
  });

  it('falls back to the two end stations when the route has no station list', async () => {
    fetchRecentNotices.mockResolvedValue([notice('2호선 이대역 무정차 통과중', 40)]);
    const route = option([segment('02', '02_240', '02_243')]);

    await service.annotate([route], graph);

    expect(route.segments[0].operationStatus).toBe('NORMAL');
  });

  it('treats a notice without a station as affecting the whole line', async () => {
    fetchRecentNotices.mockResolvedValue([notice('2호선 열차지연', 10, { categoryCode: '5' })]);
    const route = option([segment('02', '02_242', '02_243')], ['02_242', '02_243']);

    await service.annotate([route], graph);

    expect(route.segments[0].operationStatus).toBe('DISRUPTED');
  });

  it('does not report an incident that a later notice has resolved or that is older than two hours', async () => {
    fetchRecentNotices.mockResolvedValue([
      notice('2호선 이대역 무정차 통과중', 60),
      notice('2호선 이대역 열차 정상운행', 30, { categoryCode: '6' }),
      notice('2호선 신촌역 무정차 통과중', 200),
    ]);
    const route = option([segment('02', '02_240', '02_243')], ['02_240', '02_241', '02_242', '02_243']);

    await service.annotate([route], graph);

    expect(route.segments[0].operationStatus).toBe('NORMAL');
  });

  it('leaves walking segments out and is UNKNOWN for a line whose notices are not complete', async () => {
    const route = option([walk(), segment('09', '09_925', '09_926')], ['09_925', '09_926']);

    await service.annotate([route], graph);

    expect(route.segments[0].operationStatus).toBe('UNKNOWN');
    expect(route.segments[1].operationStatus).toBe('UNKNOWN');
    expect(route.operationStatus).toBe('UNKNOWN');
  });

  it('is UNKNOWN for a route that mixes a known line with an unknown one', async () => {
    const route = option(
      [segment('09', '09_925', '09_926'), segment('02', '02_240', '02_243')],
      ['09_925', '09_926', '02_240', '02_241', '02_242', '02_243'],
    );

    await service.annotate([route], graph);

    expect(route.segments.map((s) => s.operationStatus)).toEqual(['UNKNOWN', 'NORMAL']);
    expect(route.operationStatus).toBe('UNKNOWN');
  });

  it('keeps everything UNKNOWN when the notices could not be loaded', async () => {
    fetchRecentNotices.mockResolvedValue(null);
    const route = option([segment('02', '02_240', '02_243')], ['02_240', '02_243']);

    await service.annotate([route], graph);

    expect(route.segments[0].operationStatus).toBe('UNKNOWN');
    expect(route.operationStatus).toBe('UNKNOWN');
  });

  it('never fails the route search when the provider throws', async () => {
    fetchRecentNotices.mockRejectedValue(new Error('boom'));
    const route = option([segment('02', '02_240', '02_243')]);

    await expect(service.annotate([route], graph)).resolves.toBeUndefined();
    expect(route.operationStatus).toBe('UNKNOWN');
  });

  it('annotates every option of a search with the same notices', async () => {
    fetchRecentNotices.mockResolvedValue([notice('2호선 이대역 무정차 통과중', 40)]);
    const a = option([segment('02', '02_240', '02_243')], ['02_240', '02_241', '02_242', '02_243']);
    const b = option([segment('02', '02_242', '02_243')], ['02_242', '02_243']);

    await service.annotate([a, b], graph);

    expect([a.operationStatus, b.operationStatus]).toEqual(['DISRUPTED', 'NORMAL']);
    expect(fetchRecentNotices).toHaveBeenCalledTimes(1);
  });
});
