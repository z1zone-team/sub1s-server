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
      '신도림',
      '신림',
      '왕십리',
      '서울',
      '명지대',
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

    it('받침이 소리 나는 대로 옮겨 적힌 역 이름을 고친다 (신도림역 → 신돌이 멱, 2026-11-26 운영 전사)', () => {
      expect(parse('신돌이 멱에서 왕십리역까지 덜 붐비는 길.')).toBe(
        '신도림 → 왕십리',
      );
    });

    describe('경로 조건 표현으로 모드를 고른다 (2026-11-26 운영 전사)', () => {
      const mode = (text: string) => parser.parseIntent(text).preferredMode;

      it.each([
        ['서울역에서 잠실역까지 빠른 길로 가고 싶어.', 'FASTEST'],
        ['강남역에서 사당역까지 가장 빠른 길로 안내해줘', 'FASTEST'],
        ['강남역에서 잠실역까지 급해 빨리 가줘', 'FASTEST'],
        ['강남역에서 잠실역까지 환승 적게 가져와.', 'FEWEST_TRANSFERS'],
        ['강남역에서 잠실역까지 갈아타지 않고 가고 싶어', 'FEWEST_TRANSFERS'],
        ['강남역에서 잠실역까지 환승 없이', 'FEWEST_TRANSFERS'],
        ['강남역에서 잠실역까지 덜 걷는 길로', 'LEAST_WALK'],
        ['강남역에서 잠실역까지 걷는 거 적게', 'LEAST_WALK'],
        [
          '명지대역에서 강남역까지 가야 하는데 사람이 적은 길로 알려줄래.',
          'COMFORTABLE',
        ],
        ['강남역에서 잠실역까지 한산한 길', 'COMFORTABLE'],
        ['강남역에서 잠실역까지 덜 붐비는 길', 'COMFORTABLE'],
        ['신도림역에서 왕십리역까지 덜 분비는 길', 'COMFORTABLE'],
        ['강남역에서 잠실역까지 가는 길 알려줘.', 'OPTIMAL'],
      ])('%s → %s', (text, expected) => {
        expect(mode(text)).toBe(expected);
      });

      it('조건 표현이 있어도 출발역과 도착역은 그대로 찾는다', () => {
        expect(parse('서울역에서 잠실역까지 빠른 길로 가고 싶어.')).toBe(
          '서울 → 잠실',
        );
        expect(parse('강남역에서 잠실역까지 환승 적게 가져와.')).toBe(
          '강남 → 잠실',
        );
      });
    });

    it('이름을 정확히 말했으면 그대로 쓴다', () => {
      expect(parse('강남역에서 사당역까지 가장 빠른 길로 안내해줘')).toBe(
        '강남 → 사당',
      );
    });

    it('단어 경계를 넘는 우연한 일치에 속지 않는다 (홍제에서 초당 → 에서초당의 서초)', () => {
      expect(parse('홍제에서 초당까지 가는 길 알려줘')).toBe('홍제 → 초당');
    });

    it('받침과 모음을 잘못 알아들은 이름을 가장 가까운 역으로 보정한다', () => {
      expect(parse('선정능역에서 도봉 사녁까지 가장 빠른 길로 안내해줘')).toBe(
        '선정릉 → 도봉산',
      );
      expect(parse('완전에서 중개까지 가는 길 알려줘')).toBe('완정 → 중계');
    });

    it('이름 안에 공백이 끼어도 찾는다 (광흥 창, 동두천 중앙)', () => {
      expect(parse('광흥 창역에서 합정역까지 가는 길 알려줘')).toBe(
        '광흥창 → 합정',
      );
      expect(
        parse('동두천 중앙역에서 송도역까지 가장 빠른 길로 안내해줘'),
      ).toBe('동두천중앙 → 송도');
    });

    it('연음으로 `역`이 `격`으로 들린 것도 찾는다 (발고격에서)', () => {
      expect(parse('발고격에서 화랑대역까지 가장 빠른 길로 안내해줘')).toBe(
        '발곡 → 화랑대',
      );
    });

    it('숫자로 들린 이름도 보정한다 (1진로 입구역 → 을지로입구)', () => {
      expect(parse('강남역에서 1진로 입구역까지 가장 빠른 길로 안내해줘')).toBe(
        '강남 → 을지로입구',
      );
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
      expect(parse('여기에서 강남까지 가는 길 알려줘')).toBe(
        '현재 위치 → 강남',
      );
      expect(parse('지금 있는 곳에서 강남까지 가는 길 알려줘')).toBe(
        '현재 위치 → 강남',
      );
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

describe('IntentParserService 저장한 집과 학교', () => {
  let service: IntentParserService;
  const stations = ['강남', '사당', '홍제', '광흥창'];
  const graph = {
    getGraph: () => ({
      stationCount: stations.length,
      station: (idx: number) => ({ id: `s${idx}`, stationName: stations[idx] }),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentParserService,
        { provide: SubwayGraphService, useValue: graph },
      ],
    }).compile();
    service = module.get(IntentParserService);
  });

  const parse = (text: string) => {
    const { originStationName, destStationName } = service.parseIntent(text);
    return [originStationName, destStationName];
  };

  it.each([
    ['집으로 가자', ['현재 위치', '집']],
    ['집 가는 길', ['현재 위치', '집']],
    ['우리 집 가는 길', ['현재 위치', '집']],
    ['내 집으로 가고 싶어', ['현재 위치', '집']],
    ['학교 가는 길', ['현재 위치', '학교']],
    ['학교로 가자', ['현재 위치', '학교']],
    ['학교', ['현재 위치', '학교']],
  ])('도착이 장소: %s', (text, expected) => {
    expect(parse(text)).toEqual(expected);
  });

  it.each([
    ['집에서 강남까지', ['집', '강남']],
    ['집에서 강남역까지 가장 빠르게', ['집', '강남']],
    ['학교에서 사당으로 가자', ['학교', '사당']],
    ['우리 집에서 홍제역까지', ['집', '홍제']],
    ['집부터 강남까지', ['집', '강남']],
  ])('출발이 장소: %s', (text, expected) => {
    expect(parse(text)).toEqual(expected);
  });

  it.each([
    ['강남에서 집으로', ['강남', '집']],
    ['강남역에서 학교까지', ['강남', '학교']],
    ['사당에서 우리 집 가는 길', ['사당', '집']],
  ])('도착이 장소이고 출발역을 말함: %s', (text, expected) => {
    expect(parse(text)).toEqual(expected);
  });

  it('집에서 학교까지처럼 둘 다 장소일 수 있다', () => {
    expect(parse('집에서 학교까지')).toEqual(['집', '학교']);
    expect(parse('학교에서 집으로')).toEqual(['학교', '집']);
  });

  it('출발 표지 없이 역과 장소를 함께 말하면 역은 출발이 아니라고 보고 현재 위치에서 출발한다', () => {
    expect(parse('강남 집으로')).toEqual(['현재 위치', '집']);
  });

  it('역 이름 안에 공백이 들어가도 장소와 함께 찾는다 (집에서 광흥 창까지)', () => {
    expect(parse('집에서 광흥 창까지')).toEqual(['집', '광흥창']);
  });

  it('이 시험의 역 목록에서 가까운 역이 하나뿐이면 장소와 함께 보정한다 (집에서 상당으로)', () => {
    expect(parse('집에서 상당으로')).toEqual(['집', '사당']);
  });

  it('집에서 출발한다고만 하고 도착역이 없으면 알아듣지 못했다고 알린다', () => {
    expect(() => service.parseIntent('집에서 가자')).toThrow(
      expect.objectContaining({ errorCode: 'VOICE_INTENT_NOT_UNDERSTOOD' }),
    );
  });

  it('같은 장소에서 같은 장소로는 알아듣지 못했다고 알린다', () => {
    expect(() => service.parseIntent('집에서 집으로')).toThrow(
      expect.objectContaining({ errorCode: 'VOICE_INTENT_NOT_UNDERSTOOD' }),
    );
  });

  it.each([
    '모집 공고 강남역 가는 길',
    '집중해서 강남역 가는 길',
    '학교생활 강남역 가는 길',
  ])('`집`, `학교`가 다른 말의 일부면 장소로 보지 않는다: %s', (text) => {
    expect(parse(text)).toEqual(['현재 위치', '강남']);
  });

  it('장소를 말하지 않은 기존 문장은 그대로다', () => {
    expect(parse('강남에서 사당까지 가장 빠르게')).toEqual(['강남', '사당']);
    expect(parse('강남역 가는 길')).toEqual(['현재 위치', '강남']);
  });
});

describe('IntentParserService 장소 이름과 주소', () => {
  let service: IntentParserService;
  const stations = ['강남', '을지로입구', '명지대', '서울숲', '사당'];
  const graph = {
    getGraph: () => ({
      stationCount: stations.length,
      station: (idx: number) => ({ id: `s${idx}`, stationName: stations[idx] }),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentParserService,
        { provide: SubwayGraphService, useValue: graph },
      ],
    }).compile();
    service = module.get(IntentParserService);
  });

  const parse = (text: string) => {
    const { originStationName, destStationName } = service.parseIntent(text);
    return [originStationName, destStationName];
  };

  describe('출발 표지가 있을 때', () => {
    it.each([
      ['강남역에서 문화로 67-1로 가자', ['강남', '문화로 67-1']],
      ['강남에서 문화로 67-1 가는 길', ['강남', '문화로 67-1']],
      [
        '강남역에서 경기도 광주시 문화로 67-1로 가자',
        ['강남', '경기도 광주시 문화로 67-1'],
      ],
      ['강남에서 가양동 1460까지', ['강남', '가양동 1460']],
    ])(
      '도착이 주소이면 말한 주소를 그대로 도착으로 넘긴다: %s',
      (text, expected) => {
        expect(parse(text)).toEqual(expected);
      },
    );

    it.each([
      [
        '강남에서 명지대학교 인문캠퍼스로 가자',
        ['강남', '명지대학교 인문캠퍼스'],
      ],
      ['강남역에서 서울 시청광장까지', ['강남', '서울 시청광장']],
    ])(
      '도착이 역 이름으로 풀리지 않는 장소 이름이면 말한 구절을 넘긴다: %s',
      (text, expected) => {
        expect(parse(text)).toEqual(expected);
      },
    );

    it('역 이름은 지금처럼 역으로 풀린다', () => {
      expect(parse('강남에서 을지로입구까지')).toEqual(['강남', '을지로입구']);
      expect(parse('강남역에서 사당역으로 가자')).toEqual(['강남', '사당']);
    });

    it('역 이름을 조금 잘못 알아들은 것은 지금처럼 보정한다', () => {
      expect(parse('강남에서 울지로입구까지')).toEqual(['강남', '을지로입구']);
    });

    it('경로 조건을 말한 구절은 장소로 넘기지 않는다', () => {
      expect(() => service.parseIntent('강남에서 편한 길로 가자')).toThrow(
        expect.objectContaining({ errorCode: 'VOICE_INTENT_NOT_UNDERSTOOD' }),
      );
    });
  });

  describe('도착지만 말했을 때', () => {
    it.each([
      ['명지대학교 인문캠퍼스로 가자', '명지대학교 인문캠퍼스'],
      ['명지대학교 인문캠퍼스 가는 길 알려줘', '명지대학교 인문캠퍼스'],
      ['강남대로 396 가는 길', '강남대로 396'],
    ])(
      '사전의 역 이름이 더 긴 낱말의 앞부분일 뿐이면 장소로 본다: %s',
      (text, dest) => {
        expect(parse(text)).toEqual(['현재 위치', dest]);
      },
    );

    it.each([
      ['문화로 67-1 가는 길', '문화로 67-1'],
      ['문화로 67-1로 가자', '문화로 67-1'],
      ['가양동 1460 가는 길', '가양동 1460'],
    ])('역 없이 주소만 말하면 그 주소가 도착이다: %s', (text, dest) => {
      expect(parse(text)).toEqual(['현재 위치', dest]);
    });

    it.each([
      ['명지대역 가는 길', '명지대'],
      ['명지대 가는 길', '명지대'],
      ['명지대로 가자', '명지대'],
      ['강남역 가는 길 알려줘', '강남'],
      ['서울숲 근처로 가자', '서울숲'],
    ])('낱말이 역 이름에서 끝나면 지금처럼 역이다: %s', (text, dest) => {
      expect(parse(text)).toEqual(['현재 위치', dest]);
    });

    it('번지만 말하거나 장소도 주소도 아니면 알아듣지 못했다고 알린다', () => {
      for (const text of ['67-1 가는 길', '지하철 경로 알려주세요']) {
        expect(() => service.parseIntent(text)).toThrow(
          expect.objectContaining({ errorCode: 'VOICE_INTENT_NOT_UNDERSTOOD' }),
        );
      }
    });
  });
});

describe('IntentParserService 출발지가 장소 이름이나 주소일 때', () => {
  let service: IntentParserService;
  const stations = ['강남', '을지로입구', '명지대', '서울숲', '사당'];
  const graph = {
    getGraph: () => ({
      stationCount: stations.length,
      station: (idx: number) => ({ id: `s${idx}`, stationName: stations[idx] }),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentParserService,
        { provide: SubwayGraphService, useValue: graph },
      ],
    }).compile();
    service = module.get(IntentParserService);
  });

  const parse = (text: string) => {
    const { originStationName, destStationName } = service.parseIntent(text);
    return [originStationName, destStationName];
  };

  it.each([
    ['명지대학교 자연캠퍼스에서 강남까지', ['명지대학교 자연캠퍼스', '강남']],
    [
      '국립중앙박물관에서 을지로입구역까지 가자',
      ['국립중앙박물관', '을지로입구'],
    ],
    ['문화로 67-1에서 강남까지', ['문화로 67-1', '강남']],
    [
      '경기도 광주시 문화로 67-1에서 강남역으로 가자',
      ['경기도 광주시 문화로 67-1', '강남'],
    ],
  ])(
    '출발이 장소 이름이나 주소이면 말한 구절을 그대로 출발로 넘긴다: %s',
    (text, expected) => {
      expect(parse(text)).toEqual(expected);
    },
  );

  it('출발과 도착이 모두 장소 이름이나 주소이면 둘 다 그대로 넘긴다', () => {
    expect(
      parse('명지대학교 자연캠퍼스에서 명지대학교 인문캠퍼스까지'),
    ).toEqual(['명지대학교 자연캠퍼스', '명지대학교 인문캠퍼스']);
  });

  it('짧아서 역 이름을 잘못 알아들은 것으로 보이는 출발은 지금처럼 알린다', () => {
    expect(() => parse('아무개에서 강남까지')).toThrow(
      expect.objectContaining({ errorCode: 'VOICE_INTENT_NOT_UNDERSTOOD' }),
    );
  });

  it('현재 위치를 뜻하는 말과 역 이름 출발은 그대로 둔다', () => {
    expect(parse('여기에서 강남까지')).toEqual(['현재 위치', '강남']);
    expect(parse('강남에서 을지로입구까지')).toEqual(['강남', '을지로입구']);
  });
});
