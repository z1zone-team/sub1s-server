import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
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
      ],
    }).compile();

    service = module.get<VoiceService>(VoiceService);
    voiceLockService = module.get<VoiceLockService>(VoiceLockService);
    aiServiceAdapter = module.get<AiServiceAdapter>(AiServiceAdapter);
    routeService = module.get<RouteService>(RouteService);
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
});
