import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '../../infra/auth/current-user.decorator';
import { VoiceController } from './voice.controller';
import { UploadedAudioFile, VoiceService } from './voice.service';
import { VoiceJobService } from './voice-job.service';

describe('VoiceController', () => {
  let controller: VoiceController;
  let voiceService: VoiceService;
  let voiceJobService: VoiceJobService;

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
    openTtsStream: jest.fn().mockResolvedValue({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      contentType: 'audio/mpeg',
    }),
  };

  const mockVoiceJobService = {
    submit: jest
      .fn()
      .mockResolvedValue({ jobId: 'job-1', status: 'QUEUED' as const }),
    getStatus: jest
      .fn()
      .mockResolvedValue({ jobId: 'job-1', status: 'PROCESSING' as const }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VoiceController],
      providers: [
        {
          provide: VoiceService,
          useValue: mockVoiceService,
        },
        {
          provide: VoiceJobService,
          useValue: mockVoiceJobService,
        },
      ],
    }).compile();

    controller = module.get<VoiceController>(VoiceController);
    voiceService = module.get<VoiceService>(VoiceService);
    voiceJobService = module.get<VoiceJobService>(VoiceJobService);
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

    expect(result.success).toBe(true);
    expect(result.data.transcript).toBe('강남역에서 을지로입구역까지');
    expect(result.timestamp).toMatch(/\+09:00$/);
    expect(voiceService.recommendRouteByVoice).toHaveBeenCalledWith(
      mockUser.id,
      sampleFile,
      { preferredMode: 'OPTIMAL' },
    );
  });

  it('streamTts는 AI 서비스의 오디오를 audio/mpeg 스트림으로 돌려준다', async () => {
    const file = await controller.streamTts({ text: '안내합니다' });

    expect(voiceService.openTtsStream).toHaveBeenCalledWith('안내합니다');
    expect(file.getHeaders().type).toBe('audio/mpeg');
    expect(file.getHeaders().disposition).toContain('inline');
  });

  it('submitJob은 큐에 넣고 작업 ID를 봉투에 담아 돌려준다', async () => {
    const file: UploadedAudioFile = {
      fieldname: 'file',
      originalname: 'q.m4a',
      encoding: '7bit',
      mimetype: 'audio/m4a',
      size: 10,
      buffer: Buffer.from('audio'),
    };

    const result = await controller.submitJob(mockUser, file, {
      preferredMode: 'OPTIMAL',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ jobId: 'job-1', status: 'QUEUED' });
    expect(result.timestamp).toMatch(/\+09:00$/);
    expect(voiceJobService.submit).toHaveBeenCalledWith(mockUser.id, file, {
      preferredMode: 'OPTIMAL',
    });
  });

  it('getJob은 본인 ID로 작업 상태를 조회한다', async () => {
    const result = await controller.getJob(mockUser, { jobId: 'job-1' });

    expect(result.data).toEqual({ jobId: 'job-1', status: 'PROCESSING' });
    expect(voiceJobService.getStatus).toHaveBeenCalledWith(mockUser.id, 'job-1');
  });
});
