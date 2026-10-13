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
    const intent = service.parseIntent(
      '강남에서 을지로입구로 여유롭고 편하게 갈래',
    );
    expect(intent.originStationName).toBe('강남');
    expect(intent.destStationName).toBe('을지로입구');
    expect(intent.preferredMode).toBe('COMFORTABLE');
  });

  it('should detect CHEAPEST mode from keywords', () => {
    const intent = service.parseIntent(
      '강남역부터 을지로입구역까지 최소 비용으로 안내해줘',
    );
    expect(intent.preferredMode).toBe('CHEAPEST');
  });

  it('should prioritize overrideMode if provided', () => {
    const intent = service.parseIntent(
      '강남에서 을지로입구 최단으로',
      'COMFORTABLE',
    );
    expect(intent.preferredMode).toBe('COMFORTABLE');
    expect(intent.reason).toContain('COMFORTABLE');
  });

  it('uses the current location as origin when only a destination is spoken', () => {
    const intent = service.parseIntent('강남역 가는 길 알려줘');
    expect(intent.originStationName).toBe('현재 위치');
    expect(intent.destStationName).toBe('강남');
  });

  it('rejects text with no station instead of returning fixed stations', () => {
    expect(() => service.parseIntent('지하철 경로 알려주세요')).toThrow(
      expect.objectContaining({ errorCode: 'VOICE_INTENT_NOT_UNDERSTOOD' }),
    );
  });

  describe('역 이름을 잘못 알아들었을 때 (역 이름 사전으로 보정)', () => {
    const names = [
      '선정릉',
      '정릉',
      '선릉',
      '신정',
      '도봉산',
      '도봉',
      '홍제',
      '서초',
      '초당',
      '동두천중앙',
      '동두천',
      '중앙',
      '송도',
      '광흥창',
      '합정',
      '발곡',
      '화랑대',
      '석남',
      '성남',
      '완정',
      '중계',
      '을지로입구',
      '강남',
      '사당',
      '잠실',
    ];
    let parser: IntentParserService;

    beforeEach(async () => {
      const graph = {
        stationCount: names.length,
        station: (i: number) => ({ id: `s${i}`, stationName: names[i] }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          IntentParserService,
          { provide: SubwayGraphService, useValue: { getGraph: () => graph } },
        ],
      }).compile();
      parser = module.get(IntentParserService);
    });

    const parse = (text: string) => {
      const intent = parser.parseIntent(text);
      return `${intent.originStationName} → ${intent.destStationName}`;
    };

    it('이름을 정확히 말했으면 그대로 쓴다', () => {
      expect(parse('강남역에서 사당역까지 가장 빠른 길로 안내해줘')).toBe('강남 → 사당');
    });

    it('단어 경계를 넘는 우연한 일치에 속지 않는다 (홍제에서 초당 → 에서초당의 서초)', () => {
      expect(parse('홍제에서 초당까지 가는 길 알려줘')).toBe('홍제 → 초당');
    });

    it('받침과 모음을 잘못 알아들은 이름을 가장 가까운 역으로 보정한다', () => {
      expect(parse('선정능역에서 도봉 사녁까지 가장 빠른 길로 안내해줘')).toBe('선정릉 → 도봉산');
      expect(parse('완전에서 중개까지 가는 길 알려줘')).toBe('완정 → 중계');
    });

    it('이름 안에 공백이 끼어도 찾는다 (광흥 창, 동두천 중앙)', () => {
      expect(parse('광흥 창역에서 합정역까지 가는 길 알려줘')).toBe('광흥창 → 합정');
      expect(parse('동두천 중앙역에서 송도역까지 가장 빠른 길로 안내해줘')).toBe('동두천중앙 → 송도');
    });

    it('연음으로 `역`이 `격`으로 들린 것도 찾는다 (발고격에서)', () => {
      expect(parse('발고격에서 화랑대역까지 가장 빠른 길로 안내해줘')).toBe('발곡 → 화랑대');
    });

    it('숫자로 들린 이름도 보정한다 (1진로 입구역 → 을지로입구)', () => {
      expect(parse('강남역에서 1진로 입구역까지 가장 빠른 길로 안내해줘')).toBe('강남 → 을지로입구');
    });

    it('앞에 군더더기 말이 있어도 출발역을 찾는다', () => {
      expect(parse('지금 잠실에서 강남까지 가고 싶어')).toBe('잠실 → 강남');
    });

    it('어느 역인지 모호하면 보정하지 않는다 (섬남은 석남인지 성남인지) - 출발역을 못 찾았다고 알린다', () => {
      expect(() => parse('섬남에서 강남까지 가는 길 알려줘')).toThrow(
        expect.objectContaining({ errorCode: 'VOICE_INTENT_NOT_UNDERSTOOD' }),
      );
    });

    it('에서를 말했는데 출발역을 못 찾으면 조용히 현재 위치로 보지 않는다', () => {
      expect(() => parse('아무개에서 강남까지 가는 길 알려줘')).toThrow(
        expect.objectContaining({ errorCode: 'VOICE_INTENT_NOT_UNDERSTOOD' }),
      );
    });

    it('현재 위치를 뜻하는 말은 그대로 현재 위치에서 출발한다 (여기에서, 지금)', () => {
      expect(parse('여기에서 강남까지 가는 길 알려줘')).toBe('현재 위치 → 강남');
      expect(parse('지금 있는 곳에서 강남까지 가는 길 알려줘')).toBe('현재 위치 → 강남');
    });

    it('출발과 도착이 같은 역으로 보정되면 보정하지 않는다', () => {
      expect(() => parse('강남에서 강남까지')).not.toThrow();
    });

    it('출발지를 말하지 않으면 현재 위치에서 출발한다 (기존 동작)', () => {
      expect(parse('강남역 가는 길 알려줘')).toBe('현재 위치 → 강남');
    });

    it('여러 번 불러도 같은 결과다(역 사전은 한 번만 만든다)', () => {
      const first = parse('선정능역에서 도봉 사녁까지 안내해줘');
      expect(parse('선정능역에서 도봉 사녁까지 안내해줘')).toBe(first);
    });
  });
});
