import { Test, TestingModule } from '@nestjs/testing';
import { SubwayGraphService } from '../../../domain/subway/services/subway-graph.service';
import { IntentParserService } from './intent-parser.service';

describe('IntentParserService', () => {
  let service: IntentParserService;

  const mockGraphService = {
    getGraph: jest.fn().mockReturnValue({
      stationCount: 2,
      station: (idx: number) => {
        if (idx === 0) return { id: '02_222', stationName: '강남' };
        return { id: '02_202', stationName: '을지로입구' };
      },
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentParserService,
        {
          provide: SubwayGraphService,
          useValue: mockGraphService,
        },
      ],
    }).compile();

    service = module.get<IntentParserService>(IntentParserService);
  });

  it('should parse origin and destination stations correctly from typical query', () => {
    const intent = service.parseIntent('강남역에서 을지로입구역까지 가고 싶어');
    expect(intent.originStationName).toBe('강남');
    expect(intent.destStationName).toBe('을지로입구');
    expect(intent.preferredMode).toBe('OPTIMAL');
  });

  it('should detect COMFORTABLE mode from keywords', () => {
    const intent = service.parseIntent('강남에서 을지로입구로 여유롭고 편하게 갈래');
    expect(intent.originStationName).toBe('강남');
    expect(intent.destStationName).toBe('을지로입구');
    expect(intent.preferredMode).toBe('COMFORTABLE');
  });

  it('should detect CHEAPEST mode from keywords', () => {
    const intent = service.parseIntent('강남역부터 을지로입구역까지 최소 비용으로 안내해줘');
    expect(intent.preferredMode).toBe('CHEAPEST');
  });

  it('should prioritize overrideMode if provided', () => {
    const intent = service.parseIntent('강남에서 을지로입구 최단으로', 'COMFORTABLE');
    expect(intent.preferredMode).toBe('COMFORTABLE');
    expect(intent.reason).toContain('COMFORTABLE');
  });

  it('should fallback to default stations when text does not match patterns', () => {
    const intent = service.parseIntent('지하철 경로 알려주세요');
    expect(intent.originStationName).toBe('강남');
    expect(intent.destStationName).toBe('을지로입구');
  });
});
