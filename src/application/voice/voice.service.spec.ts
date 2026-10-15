import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { USER_PLACE_REPOSITORY } from '../../domain/user/ports/IUserPlaceRepository';
import { PlaceService } from '../place/place.service';
import { RouteService } from '../route/route.service';
import { VoiceResultDto, VoiceRouteRecommendResponseDto } from './dto';
import { AiServiceAdapter } from './services/ai-service.adapter';
import {
  CURRENT_LOCATION,
  IntentParserService,
} from './services/intent-parser.service';
import { UploadedAudioFile, VoiceService } from './voice.service';

describe('VoiceService', () => {
  let service: VoiceService;
  let routeService: RouteService;
  let intentParser: { parseIntent: jest.Mock };
  let placeRepo: { findAll: jest.Mock };
  let placeService: { search: jest.Mock };
  let ai: { generateBriefing: jest.Mock };

  // 경로 결과이면 그대로, 확인 요청이면 테스트를 실패시킨다
  const asRoute = (result: VoiceResultDto): VoiceRouteRecommendResponseDto => {
    if (result.kind !== 'ROUTE') {
      throw new Error(`route expected, got ${result.kind}`);
    }
    return result;
  };

  const sampleFile: UploadedAudioFile = {
    fieldname: 'file',
    originalname: 'query.wav',
    encoding: '7bit',
    mimetype: 'audio/wav',
    size: 1024,
    buffer: Buffer.from('fake-audio-content'),
  };

  const sampleRouteOption = {
    mode: 'OPTIMAL' as const,
    totalDurationSec: 2580,
    totalDistanceKm: 18.5,
    totalFare: 1600,
    transferCount: 0,
    estimatedArrivalTimestamp: '2026-10-06T12:00:00.000Z',
    segments: [],
  };

  const mockGraph = {
    stationCount: 2,
    station: (idx: number) => {
      if (idx === 0) return { id: '02_222', stationName: '강남' };
      return { id: '02_202', stationName: '을지로입구' };
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceService,
        {
          provide: AiServiceAdapter,
          useValue: {
            transcribeAudio: jest.fn().mockResolvedValue({
              transcript: '강남역에서 을지로입구역까지 최적 경로로 안내해줘',
            }),
            generateBriefing: jest.fn().mockResolvedValue({
              briefingText:
                '강남역에서 을지로입구역까지 최적 경로로 안내합니다.',
              audioTtsUrl: '/api/v1/voice/tts/stream?text=test',
            }),
          },
        },
        {
          provide: IntentParserService,
          useValue: {
            normalizeStationName: (name: string) => name.replace(/역$/, ''),
            parseIntent: jest.fn().mockReturnValue({
              originStationName: '강남',
              destStationName: '을지로입구',
              preferredMode: 'OPTIMAL',
              reason: '최적 경로 추천',
            }),
          },
        },
        {
          provide: SubwayGraphService,
          useValue: {
            getGraph: jest.fn().mockReturnValue(mockGraph),
          },
        },
        {
          provide: RouteService,
          useValue: {
            search: jest.fn().mockResolvedValue({
              options: [sampleRouteOption],
            }),
          },
        },
        {
          provide: USER_PLACE_REPOSITORY,
          useValue: { findAll: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: PlaceService,
          useValue: { search: jest.fn().mockResolvedValue({ items: [] }) },
        },
      ],
    }).compile();

    service = module.get<VoiceService>(VoiceService);
    routeService = module.get<RouteService>(RouteService);
    intentParser = module.get(IntentParserService);
    placeRepo = module.get(USER_PLACE_REPOSITORY);
    placeService = module.get(PlaceService);
    ai = module.get(AiServiceAdapter);
  });

  it('should recommend a route from a transcript', async () => {
    const result = asRoute(
      await service.recommendFromTranscript(
        'user-1',
        '강남역에서 을지로입구역까지 최적 경로로 안내해줘',
        { preferredMode: 'OPTIMAL' },
      ),
    );

    expect(result.kind).toBe('ROUTE');
    expect(result).toBeDefined();
    expect(result.transcript).toBe(
      '강남역에서 을지로입구역까지 최적 경로로 안내해줘',
    );
    expect(result.interpretedIntent.originStationName).toBe('강남');
    expect(result.interpretedIntent.destStationName).toBe('을지로입구');
    expect(result.recommendedRoute.mode).toBe('OPTIMAL');
    expect(result.briefingText).toContain('강남역에서 을지로입구역');
    expect(result.audioTtsUrl).toBeDefined();
  });

  it('should throw BadRequestException if file is missing or empty', () => {
    expect(() => service.validateAudioFile(undefined)).toThrow(
      BadRequestException,
    );

    const emptyFile: UploadedAudioFile = {
      ...sampleFile,
      buffer: Buffer.alloc(0),
    };
    expect(() => service.validateAudioFile(emptyFile)).toThrow(
      BadRequestException,
    );
  });

  it('should throw BadRequestException if file exceeds 5MB limit', () => {
    const largeFile: UploadedAudioFile = {
      ...sampleFile,
      size: 6 * 1024 * 1024,
    };
    expect(() => service.validateAudioFile(largeFile)).toThrow(
      '오디오 파일 크기는 최대 5MB를 초과할 수 없습니다.',
    );
  });

  it('should throw BadRequestException for unsupported file formats', () => {
    const invalidFile: UploadedAudioFile = {
      ...sampleFile,
      originalname: 'malware.exe',
      mimetype: 'application/x-msdownload',
    };
    expect(() => service.validateAudioFile(invalidFile)).toThrow(
      '지원하지 않는 오디오 파일 형식입니다.',
    );
  });

  it('should throw NotFoundException if station is unknown in subway network', async () => {
    jest.spyOn(service, 'findStationIdByName').mockReturnValueOnce(null);

    await expect(
      service.recommendFromTranscript('user-6', '강남역에서 을지로입구역까지 최적 경로로 안내해줘'),
    ).rejects.toThrow(NotFoundException);
  });

  it('searches from the current location when only a destination is spoken', async () => {
    const parser = (
      service as unknown as { intentParserService: { parseIntent: jest.Mock } }
    ).intentParserService;
    parser.parseIntent.mockReturnValueOnce({
      originStationName: '현재 위치',
      destStationName: '강남',
      preferredMode: 'OPTIMAL',
      reason: '최적 경로 추천',
    });

    await service.recommendFromTranscript('user-loc', '강남역에서 을지로입구역까지 최적 경로로 안내해줘', {
      lat: 37.5,
      lng: 127.03,
    });

    expect(routeService.search).toHaveBeenCalledWith(
      expect.objectContaining({ originLat: 37.5, originLng: 127.03 }),
      'user-loc',
    );
  });

  it('passes the signed-in user to the route search so the recommendation is personalized', async () => {
    await service.recommendFromTranscript('user-personal', '강남역에서 을지로입구역까지 최적 경로로 안내해줘', {});

    expect(routeService.search).toHaveBeenCalledWith(
      expect.any(Object),
      'user-personal',
    );
  });

  it('asks for the origin when it is not spoken and no location is sent', async () => {
    const parser = (
      service as unknown as { intentParserService: { parseIntent: jest.Mock } }
    ).intentParserService;
    parser.parseIntent.mockReturnValueOnce({
      originStationName: '현재 위치',
      destStationName: '강남',
      preferredMode: 'OPTIMAL',
      reason: '최적 경로 추천',
    });

    await expect(
      service.recommendFromTranscript('user-noloc', '강남역에서 을지로입구역까지 최적 경로로 안내해줘'),
    ).rejects.toMatchObject({
      errorCode: 'VOICE_ORIGIN_REQUIRED',
    });
  });
  describe('저장한 집과 학교', () => {
    const intent = (originStationName: string, destStationName: string) => ({
      originStationName,
      destStationName,
      preferredMode: 'OPTIMAL' as const,
      reason: '최적 경로 추천',
    });
    const here = { lat: 37.5, lng: 127.0 };
    const home = (extra: Record<string, unknown>) => ({
      kind: 'HOME',
      name: '우리집',
      stationId: null,
      lat: null,
      lng: null,
      ...extra,
    });
    const searchArg = () =>
      (routeService.search as jest.Mock).mock.calls[0][0] as Record<string, unknown>;

    it('도착이 집이고 역으로 저장했으면 그 역으로 현재 위치에서 검색한다', async () => {
      intentParser.parseIntent.mockReturnValue(intent('현재 위치', '집'));
      placeRepo.findAll.mockResolvedValue([home({ stationId: '02_202' })]);

      await service.recommendFromTranscript('user-1', '집으로 가자', here);

      expect(placeRepo.findAll).toHaveBeenCalledWith('user-1');
      expect(searchArg()).toMatchObject({
        originLat: 37.5,
        originLng: 127.0,
        destinationStationId: '02_202',
      });
    });

    it('도착이 집이고 좌표로 저장했으면 좌표와 이름으로 검색한다', async () => {
      intentParser.parseIntent.mockReturnValue(intent('현재 위치', '집'));
      placeRepo.findAll.mockResolvedValue([home({ lat: 37.56, lng: 126.85 })]);

      await service.recommendFromTranscript('user-1', '집으로 가자', here);

      expect(searchArg()).toMatchObject({
        destinationLat: 37.56,
        destinationLng: 126.85,
        destinationName: '우리집',
      });
      expect(searchArg()).not.toHaveProperty('destinationStationId');
    });

    it('출발이 학교이면 저장한 학교에서 출발한다', async () => {
      intentParser.parseIntent.mockReturnValue(intent('학교', '강남'));
      placeRepo.findAll.mockResolvedValue([
        home({ kind: 'SCHOOL', name: '명지대', stationId: '02_202' }),
      ]);

      await service.recommendFromTranscript('user-1', '학교에서 강남까지');

      expect(searchArg()).toMatchObject({
        originStationId: '02_202',
        destinationStationId: '02_222',
      });
    });

    it('집이 없고 학교만 저장했으면 집은 VOICE_PLACE_NOT_SAVED(422)이다', async () => {
      intentParser.parseIntent.mockReturnValue(intent('현재 위치', '집'));
      placeRepo.findAll.mockResolvedValue([
        home({ kind: 'SCHOOL', name: '명지대', stationId: '02_202' }),
      ]);

      await expect(
        service.recommendFromTranscript('user-1', '집으로 가자', here),
      ).rejects.toMatchObject({
        errorCode: 'VOICE_PLACE_NOT_SAVED',
        status: 422,
        message: expect.stringContaining('집을'),
      });
      expect(routeService.search).not.toHaveBeenCalled();
    });

    it('학교를 저장하지 않았으면 학교를 안내한다', async () => {
      intentParser.parseIntent.mockReturnValue(intent('현재 위치', '학교'));

      await expect(
        service.recommendFromTranscript('user-1', '학교 가는 길', here),
      ).rejects.toMatchObject({
        errorCode: 'VOICE_PLACE_NOT_SAVED',
        message: expect.stringContaining('학교를'),
      });
    });

    it('저장한 집과 말한 도착역이 같은 역이면 400이다', async () => {
      intentParser.parseIntent.mockReturnValue(intent('집', '강남'));
      placeRepo.findAll.mockResolvedValue([home({ stationId: '02_222' })]);

      await expect(
        service.recommendFromTranscript('user-1', '집에서 강남까지'),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('집이나 학교가 아니면 저장한 장소를 읽지 않는다', async () => {
      await service.recommendFromTranscript('user-1', '강남에서 을지로입구까지');

      expect(placeRepo.findAll).not.toHaveBeenCalled();
      expect(searchArg()).toMatchObject({
        originStationId: '02_222',
        destinationStationId: '02_202',
      });
    });
  });

  describe('도착지가 장소 이름이나 주소일 때', () => {
    const MYONGJI = '명지대학교 인문캠퍼스';
    const nearest = {
      stationId: 'GJ_K315',
      name: '가좌',
      walkDistanceM: 900,
      walkDurationSec: 720,
    };
    const place = (name: string, address = '서울 서대문구 거북골로') => ({
      type: 'PLACE' as const,
      name,
      address,
      category: '대학교',
      lat: 37.58,
      lng: 126.92,
      nearestStation: nearest,
    });
    const station = (name: string, stationId: string) => ({
      type: 'STATION' as const,
      stationId,
      name,
      lat: 37.54,
      lng: 127.04,
      line: { lineId: '01', lineName: '1호선', colorHex: '#000000' },
      lines: [{ lineId: '01', lineName: '1호선', colorHex: '#000000' }],
    });
    const speak = (destStationName: string, originStationName = '강남') =>
      intentParser.parseIntent.mockReturnValue({
        originStationName,
        destStationName,
        preferredMode: 'OPTIMAL',
        reason: '최적 경로 추천',
      });

    it('역 이름이면 장소 검색을 하지 않는다', async () => {
      await service.recommendFromTranscript('user-1', '강남에서 을지로입구');

      expect(placeService.search).not.toHaveBeenCalled();
    });

    it('후보가 하나뿐이면 바로 그 좌표와 이름으로 경로를 찾는다', async () => {
      speak(MYONGJI);
      placeService.search.mockResolvedValue({
        items: [place('명지대학교/인문캠퍼스')],
      });

      const result = asRoute(
        await service.recommendFromTranscript('user-1', `${MYONGJI}로 가자`),
      );

      expect(placeService.search).toHaveBeenCalledWith({
        q: MYONGJI,
        limit: 10,
      });
      expect(routeService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          originStationId: '02_222',
          destinationLat: 37.58,
          destinationLng: 126.92,
          destinationName: '명지대학교/인문캠퍼스',
        }),
        'user-1',
      );
      expect(result.interpretedIntent.destStationName).toBe(MYONGJI);
    });

    it('이름이 정확히 같은 후보가 하나면 바로 안내한다(공백과 기호는 무시)', async () => {
      speak(MYONGJI);
      placeService.search.mockResolvedValue({
        items: [
          place('명지대학교/인문캠퍼스'),
          place('명지대학교 인문캠퍼스 정문'),
          place('명지대 인문캠 주차장'),
        ],
      });

      const result = await service.recommendFromTranscript(
        'user-1',
        `${MYONGJI}로 가자`,
      );

      expect(result.kind).toBe('ROUTE');
      expect(routeService.search).toHaveBeenCalledWith(
        expect.objectContaining({ destinationName: '명지대학교/인문캠퍼스' }),
        'user-1',
      );
    });

    it('환승역은 호선마다 나오는 같은 이름의 역을 하나로 합쳐 바로 안내한다', async () => {
      speak('서울숲 근처');
      placeService.search.mockResolvedValue({
        items: [station('서울숲', '09_925'), station('서울숲', 'SB_925')],
      });

      const result = await service.recommendFromTranscript(
        'user-1',
        '서울숲 근처로',
      );

      expect(result.kind).toBe('ROUTE');
      expect(routeService.search).toHaveBeenCalledWith(
        expect.objectContaining({ destinationStationId: '09_925' }),
        'user-1',
      );
    });

    it('후보가 여럿이고 이름이 정확히 같은 것이 없으면 경로를 찾지 않고 확인을 요청한다', async () => {
      speak('문화로 67-1');
      placeService.search.mockResolvedValue({
        items: [
          place('경기도 광주시 문화로 67-1', '경기도 광주시'),
          place('경기도 연천군 문화로 67-1', '경기도 연천군'),
          place('인천광역시 문화로 67-1', '인천광역시'),
        ],
      });

      const result = await service.recommendFromTranscript(
        'user-1',
        '문화로 67-1',
      );

      expect(result.kind).toBe('CONFIRM_DESTINATION');
      if (result.kind !== 'CONFIRM_DESTINATION') return;
      expect(result.transcript).toBe('문화로 67-1');
      expect(result.interpretedIntent.destStationName).toBe('문화로 67-1');
      expect(result.origin).toEqual({ name: '강남', stationId: '02_222' });
      expect(result.candidates).toHaveLength(3);
      expect(result.candidates[0]).toEqual({
        type: 'PLACE',
        name: '경기도 광주시 문화로 67-1',
        address: '경기도 광주시',
        category: '대학교',
        lat: 37.58,
        lng: 126.92,
        nearestStation: nearest,
      });
      expect(routeService.search).not.toHaveBeenCalled();
    });

    it('이름이 정확히 같은 후보가 둘 이상이면 확인을 요청한다', async () => {
      speak('중앙공원');
      placeService.search.mockResolvedValue({
        items: [
          place('중앙공원', '경기도 수원시'),
          place('중앙공원', '경기도 성남시'),
        ],
      });

      const result = await service.recommendFromTranscript(
        'user-1',
        '중앙공원',
      );

      expect(result.kind).toBe('CONFIRM_DESTINATION');
    });

    it('후보는 최대 5개까지 돌려준다', async () => {
      speak('시청');
      placeService.search.mockResolvedValue({
        items: Array.from({ length: 8 }, (_, i) => place(`시청 ${i}`)),
      });

      const result = await service.recommendFromTranscript('user-1', '시청');

      expect(result.kind).toBe('CONFIRM_DESTINATION');
      if (result.kind !== 'CONFIRM_DESTINATION') return;
      expect(result.candidates).toHaveLength(5);
    });

    it('확인 요청의 출발지가 현재 위치이면 좌표를 담는다', async () => {
      speak('문화로 67-1', CURRENT_LOCATION);
      placeService.search.mockResolvedValue({
        items: [place('가'), place('나')],
      });

      const result = await service.recommendFromTranscript(
        'user-1',
        '문화로 67-1',
        { lat: 37.2, lng: 127.1 },
      );

      expect(result.kind).toBe('CONFIRM_DESTINATION');
      if (result.kind !== 'CONFIRM_DESTINATION') return;
      expect(result.origin).toEqual({
        name: CURRENT_LOCATION,
        lat: 37.2,
        lng: 127.1,
      });
    });

    it('후보가 없으면 404이다', async () => {
      speak('없는장소');

      await expect(
        service.recommendFromTranscript('user-1', '없는장소'),
      ).rejects.toThrow(NotFoundException);
    });

    it('장소 검색이 실패해도 404로 안내한다', async () => {
      speak('없는장소');
      placeService.search.mockRejectedValue(new Error('timeout'));

      await expect(
        service.recommendFromTranscript('user-1', '없는장소'),
      ).rejects.toThrow(NotFoundException);
    });

    it('저장한 집이면 장소 검색을 하지 않는다', async () => {
      speak('집');
      placeRepo.findAll.mockResolvedValue([
        { kind: 'HOME', name: '집', stationId: '02_202' },
      ]);

      await service.recommendFromTranscript('user-1', '집으로 가자');

      expect(placeService.search).not.toHaveBeenCalled();
    });
  });

  describe('출발지가 장소 이름이나 주소일 때', () => {
    const place = (name: string, address = '서울 서대문구 거북골로') => ({
      type: 'PLACE' as const,
      name,
      address,
      lat: 37.58,
      lng: 126.92,
      nearestStation: {
        stationId: 'GJ_K315',
        name: '가좌',
        walkDistanceM: 900,
        walkDurationSec: 720,
      },
    });
    const speak = (originStationName: string, destStationName = '강남') =>
      intentParser.parseIntent.mockReturnValue({
        originStationName,
        destStationName,
        preferredMode: 'OPTIMAL',
        reason: '최적 경로 추천',
      });

    it('후보가 하나뿐이면 그 좌표와 이름으로 출발해 바로 경로를 찾는다', async () => {
      speak('명지대학교 자연캠퍼스');
      placeService.search.mockResolvedValue({
        items: [place('명지대학교 자연캠퍼스')],
      });

      const result = await service.recommendFromTranscript(
        'user-1',
        '명지대학교 자연캠퍼스에서 강남까지',
      );

      expect(result.kind).toBe('ROUTE');
      expect(placeService.search).toHaveBeenCalledWith({
        q: '명지대학교 자연캠퍼스',
        limit: 10,
      });
      expect(routeService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          originLat: 37.58,
          originLng: 126.92,
          originName: '명지대학교 자연캠퍼스',
          destinationStationId: '02_222',
        }),
        'user-1',
      );
    });

    it('출발 후보가 여럿이면 경로를 찾지 않고 확인을 요청하며 정해진 도착지를 담는다', async () => {
      speak('문화로 67-1');
      placeService.search.mockResolvedValue({
        items: [
          place('경기도 광주시 문화로 67-1', '경기도 광주시'),
          place('경기도 연천군 문화로 67-1', '경기도 연천군'),
        ],
      });

      const result = await service.recommendFromTranscript(
        'user-1',
        '문화로 67-1에서 강남까지',
      );

      expect(result.kind).toBe('CONFIRM_ORIGIN');
      if (result.kind !== 'CONFIRM_ORIGIN') return;
      expect(result.originCandidates).toHaveLength(2);
      expect(result.destination).toEqual({ name: '강남', stationId: '02_222' });
      expect(result.destinationCandidates).toBeUndefined();
      expect(routeService.search).not.toHaveBeenCalled();
    });

    it('출발과 도착이 모두 모호하면 출발 후보와 도착 후보를 함께 담는다', async () => {
      speak('시청', '중앙공원');
      placeService.search.mockImplementation(({ q }: { q: string }) =>
        Promise.resolve({
          items: [place(`${q} 가`, '가'), place(`${q} 나`, '나')],
        }),
      );

      const result = await service.recommendFromTranscript(
        'user-1',
        '시청에서 중앙공원까지',
      );

      expect(result.kind).toBe('CONFIRM_ORIGIN');
      if (result.kind !== 'CONFIRM_ORIGIN') return;
      expect(result.originCandidates.map((c) => c.name)).toEqual([
        '시청 가',
        '시청 나',
      ]);
      expect(result.destination).toBeUndefined();
      expect(result.destinationCandidates?.map((c) => c.name)).toEqual([
        '중앙공원 가',
        '중앙공원 나',
      ]);
    });

    it('출발 후보는 최대 5개까지 돌려준다', async () => {
      speak('시청');
      placeService.search.mockResolvedValue({
        items: Array.from({ length: 8 }, (_, i) => place(`시청 ${i}`)),
      });

      const result = await service.recommendFromTranscript(
        'user-1',
        '시청에서 강남까지',
      );

      expect(result.kind).toBe('CONFIRM_ORIGIN');
      if (result.kind !== 'CONFIRM_ORIGIN') return;
      expect(result.originCandidates).toHaveLength(5);
    });

    it('출발 후보가 없으면 404이다', async () => {
      speak('없는장소');

      await expect(
        service.recommendFromTranscript('user-1', '없는장소에서 강남까지'),
      ).rejects.toThrow(NotFoundException);
    });

    it('역 이름으로 출발하면 장소 검색을 하지 않는다', async () => {
      await service.recommendFromTranscript('user-1', '강남에서 을지로입구');

      expect(placeService.search).not.toHaveBeenCalled();
    });

    it('도착 후보만 여럿이면 확인 결과의 출발지가 장소의 좌표와 이름이다', async () => {
      speak('명지대학교 자연캠퍼스', '시청');
      placeService.search.mockImplementation(({ q }: { q: string }) =>
        Promise.resolve({
          items:
            q === '시청'
              ? [place('시청 가'), place('시청 나')]
              : [place('명지대학교 자연캠퍼스')],
        }),
      );

      const result = await service.recommendFromTranscript(
        'user-1',
        '명지대학교 자연캠퍼스에서 시청까지',
      );

      expect(result.kind).toBe('CONFIRM_DESTINATION');
      if (result.kind !== 'CONFIRM_DESTINATION') return;
      expect(result.origin).toEqual({
        name: '명지대학교 자연캠퍼스',
        lat: 37.58,
        lng: 126.92,
      });
    });
  });

  describe('안내 문장에서 부르는 이름', () => {
    const labels = () => ai.generateBriefing.mock.calls[0][2] as unknown;
    const place = {
      type: 'PLACE' as const,
      name: '명지대학교 인문캠퍼스',
      address: '서울 서대문구',
      lat: 37.58,
      lng: 126.92,
      nearestStation: {
        stationId: 'GJ_K315',
        name: '가좌',
        walkDistanceM: 900,
        walkDurationSec: 720,
      },
    };

    it('역 이름은 역을 붙이고 현재 위치와 장소는 붙이지 않는다', async () => {
      intentParser.parseIntent.mockReturnValue({
        originStationName: CURRENT_LOCATION,
        destStationName: '명지대학교 인문캠퍼스',
        preferredMode: 'OPTIMAL',
        reason: '최적 경로 추천',
      });
      placeService.search.mockResolvedValue({ items: [place] });

      await service.recommendFromTranscript('user-1', '명지대학교 인문캠퍼스', {
        lat: 37.2,
        lng: 127.1,
      });

      expect(labels()).toEqual({
        origin: CURRENT_LOCATION,
        destination: '명지대학교 인문캠퍼스',
      });
    });

    it('이름으로 찾은 역에는 역을 붙인다', async () => {
      await service.recommendFromTranscript('user-1', '강남에서 을지로입구');

      expect(labels()).toEqual({
        origin: '강남역',
        destination: '을지로입구역',
      });
    });

    it('저장한 집에는 역을 붙이지 않는다', async () => {
      intentParser.parseIntent.mockReturnValue({
        originStationName: '강남',
        destStationName: '집',
        preferredMode: 'OPTIMAL',
        reason: '최적 경로 추천',
      });
      placeRepo.findAll.mockResolvedValue([
        { kind: 'HOME', name: '집', stationId: '02_202' },
      ]);

      await service.recommendFromTranscript('user-1', '강남에서 집으로');

      expect(labels()).toEqual({ origin: '강남역', destination: '집' });
    });
  });
});
