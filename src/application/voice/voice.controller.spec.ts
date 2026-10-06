import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '../../infra/auth/current-user.decorator';
import { VoiceController } from './voice.controller';
import { UploadedAudioFile, VoiceService } from './voice.service';

describe('VoiceController', () => {
  let controller: VoiceController;
  let voiceService: VoiceService;

  const mockUser: AuthUser = {
    id: 'test-user-id',
    clerkId: 'clerk_test',
    nickname: 'VoiceTester',
  };

  const mockVoiceService = {
    recommendRouteByVoice: jest.fn().mockResolvedValue({
      transcript: '강남역에서 을지로입구역까지',
      interpretedIntent: {
        originStationName: '강남',
        destStationName: '을지로입구',
        preferredMode: 'OPTIMAL',
        reason: '최적 경로',
      },
      recommendedRoute: {
        mode: 'OPTIMAL',
        totalDurationSec: 2500,
        totalDistanceKm: 18.0,
        totalFare: 1600,
        transferCount: 0,
        estimatedArrivalTimestamp: '2026-10-06T12:00:00Z',
        segments: [],
      },
      briefingText: '강남역에서 을지로입구역까지 최적 경로입니다.',
      audioTtsUrl: '/api/v1/voice/tts/stream?text=test',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VoiceController],
      providers: [
        {
          provide: VoiceService,
          useValue: mockVoiceService,
        },
      ],
    }).compile();

    controller = module.get<VoiceController>(VoiceController);
    voiceService = module.get<VoiceService>(VoiceService);
  });

  it('should delegate recommendRoute call to VoiceService', async () => {
    const sampleFile: UploadedAudioFile = {
      fieldname: 'file',
      originalname: 'test.mp3',
      encoding: '7bit',
      mimetype: 'audio/mpeg',
      size: 500,
      buffer: Buffer.from('audio-data'),
    };

    const result = await controller.recommendRoute(
      mockUser,
      sampleFile,
      { preferredMode: 'OPTIMAL' },
    );

    expect(result).toBeDefined();
    expect(voiceService.recommendRouteByVoice).toHaveBeenCalledWith(
      mockUser.id,
      sampleFile,
      { preferredMode: 'OPTIMAL' },
    );
  });
});
