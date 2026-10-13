import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { USER_PLACE_REPOSITORY } from '../../domain/user/ports/IUserPlaceRepository';
import { RouteService } from '../route/route.service';
import { AiServiceAdapter } from './services/ai-service.adapter';
import { IntentParserService } from './services/intent-parser.service';
import { VoiceLockService } from './services/voice-lock.service';
import { UploadedAudioFile, VoiceService } from './voice.service';

describe('VoiceService', () => {
  let service: VoiceService;
  let voiceLockService: VoiceLockService;
  let aiServiceAdapter: AiServiceAdapter;
  let routeService: RouteService;
  let intentParser: { parseIntent: jest.Mock };
  let placeRepo: { findAll: jest.Mock };

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
        VoiceLockService,
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
      ],
    }).compile();

    service = module.get<VoiceService>(VoiceService);
    voiceLockService = module.get<VoiceLockService>(VoiceLockService);
    aiServiceAdapter = module.get<AiServiceAdapter>(AiServiceAdapter);
    routeService = module.get<RouteService>(RouteService);
    intentParser = module.get(IntentParserService);
    placeRepo = module.get(USER_PLACE_REPOSITORY);
  });

  it('should recommend route successfully for valid voice file', async () => {
    const result = await service.recommendRouteByVoice('user-1', sampleFile, {
      preferredMode: 'OPTIMAL',
    });

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

  it('should enforce 5-second idempotency lock and reject consecutive duplicate calls', async () => {
    await service.recommendRouteByVoice('user-lock-test', sampleFile);

    await expect(
      service.recommendRouteByVoice('user-lock-test', sampleFile),
    ).rejects.toThrow(
      new HttpException(
        '이전 음성 요청을 처리 중입니다. 잠시만 기다려주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
  });

  it('should throw BadRequestException if file is missing or empty', async () => {
    await expect(
      service.recommendRouteByVoice('user-2', undefined),
    ).rejects.toThrow(BadRequestException);

    const emptyFile: UploadedAudioFile = {
      ...sampleFile,
      buffer: Buffer.alloc(0),
    };
    await expect(
      service.recommendRouteByVoice('user-3', emptyFile),
    ).rejects.toThrow(BadRequestException);
  });

  it('should throw BadRequestException if file exceeds 5MB limit', async () => {
    const largeFile: UploadedAudioFile = {
      ...sampleFile,
      size: 6 * 1024 * 1024,
    };
    await expect(
      service.recommendRouteByVoice('user-4', largeFile),
    ).rejects.toThrow('오디오 파일 크기는 최대 5MB를 초과할 수 없습니다.');
  });

  it('should throw BadRequestException for unsupported file formats', async () => {
    const invalidFile: UploadedAudioFile = {
      ...sampleFile,
      originalname: 'malware.exe',
      mimetype: 'application/x-msdownload',
    };
    await expect(
      service.recommendRouteByVoice('user-5', invalidFile),
    ).rejects.toThrow('지원하지 않는 오디오 파일 형식입니다.');
  });

  it('should throw NotFoundException if station is unknown in subway network', async () => {
    jest.spyOn(service, 'findStationIdByName').mockReturnValueOnce(null);

    await expect(
      service.recommendRouteByVoice('user-6', sampleFile),
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

    await service.recommendRouteByVoice('user-loc', sampleFile, {
      lat: 37.5,
      lng: 127.03,
    });

    expect(routeService.search).toHaveBeenCalledWith(
      expect.objectContaining({ originLat: 37.5, originLng: 127.03 }),
      'user-loc',
    );
  });

  it('passes the signed-in user to the route search so the recommendation is personalized', async () => {
    await service.recommendRouteByVoice('user-personal', sampleFile, {});

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
      service.recommendRouteByVoice('user-noloc', sampleFile),
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
});
