import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { kstNowIso } from '../../common/utils/kst';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import { ClerkAuthGuard } from '../../infra/auth/clerk-auth.guard';
import {
  TtsStreamQueryDto,
  VoiceJobIdParamDto,
  VoiceJobStatusResponseDto,
  VoiceJobSubmitResponseDto,
  VoiceRouteRecommendRequestDto,
} from './dto';
import { VoiceJobService } from './voice-job.service';
import { UploadedAudioFile, VoiceService } from './voice.service';

@ApiTags('Voice')
@ApiBearerAuth('clerk-auth')
@Controller(['v1/voice', 'api/v1/voice'])
export class VoiceController {
  constructor(
    private readonly voiceService: VoiceService,
    private readonly voiceJobService: VoiceJobService,
  ) {}

  @Get('tts/stream')
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: '브리핑 문장을 음성(MP3)으로 스트리밍',
    description:
      '음성 경로 추천 응답의 `audioTtsUrl`이 가리키는 경로입니다. AI 서비스의 음성 합성을 서버가 중계하며 AI 서비스는 외부에 공개하지 않습니다. 로그인이 필요하고 문장은 1~500자입니다.',
  })
  @SwaggerResponse({ status: 200, description: 'audio/mpeg 스트림' })
  @SwaggerResponse({ status: 400, description: '문장이 비었거나 500자 초과' })
  @SwaggerResponse({ status: 401, description: '로그인 필요' })
  @SwaggerResponse({
    status: 503,
    description: 'AI 서비스를 쓸 수 없음 (AI_SERVICE_UNAVAILABLE)',
  })
  async streamTts(@Query() query: TtsStreamQueryDto): Promise<StreamableFile> {
    const { body, contentType } = await this.voiceService.openTtsStream(
      query.text,
    );
    return new StreamableFile(
      Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>),
      { type: contentType, disposition: 'inline; filename="speech.mp3"' },
    );
  }

  @Post('jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ClerkAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB (큐에는 2MB까지, 서비스가 따로 검사)
      },
    }),
  )
  @ApiOperation({
    summary: '음성 경로 추천 요청을 큐에 넣기 (비동기)',
    description:
      '오디오를 큐에 넣고 바로 `202 { jobId }`로 응답합니다. STT는 AI 워커가, 의도 분석, 경로 탐색, 브리핑은 서버 워커가 처리하고 결과는 WebSocket(`voice_result`, `voice_failed`)으로 전달합니다. 이벤트를 놓쳤으면 `GET /voice/jobs/:jobId`로 조회합니다. 오디오는 최대 2MB, 사용자당 진행 중 작업은 1건입니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '오디오 파일 및 옵션',
    type: VoiceRouteRecommendRequestDto,
  })
  @SwaggerResponse({ status: 202, description: '큐에 넣음 (QUEUED)' })
  @SwaggerResponse({ status: 400, description: '오디오 파일 누락 또는 미지원 포맷' })
  @SwaggerResponse({ status: 413, description: '오디오 2MB 초과 (VOICE_AUDIO_TOO_LARGE)' })
  @SwaggerResponse({ status: 429, description: '이전 음성 요청 처리 중 (VOICE_JOB_IN_PROGRESS)' })
  @SwaggerResponse({
    status: 503,
    description: '대기열이 가득 참(VOICE_QUEUE_FULL) 또는 큐를 쓸 수 없음(VOICE_QUEUE_UNAVAILABLE)',
  })
  async submitJob(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedAudioFile | undefined,
    @Body() dto: VoiceRouteRecommendRequestDto,
  ): Promise<ApiResponse<VoiceJobSubmitResponseDto>> {
    const data = await this.voiceJobService.submit(user.id, file, dto);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Get('jobs/:jobId')
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: '음성 경로 추천 작업 상태와 결과 조회',
    description:
      '`QUEUED`, `PROCESSING`, `COMPLETED`(result), `FAILED`(error). WebSocket 이벤트를 놓쳤을 때 쓰며 본인의 작업만 조회되고 완료 후 10분간 보관됩니다.',
  })
  @SwaggerResponse({ status: 200, description: '작업 상태' })
  @SwaggerResponse({ status: 404, description: '없거나 다른 사용자의 작업 (VOICE_JOB_NOT_FOUND)' })
  async getJob(
    @CurrentUser() user: AuthUser,
    @Param() params: VoiceJobIdParamDto,
  ): Promise<ApiResponse<VoiceJobStatusResponseDto>> {
    const data = await this.voiceJobService.getStatus(user.id, params.jobId);
    return { success: true, data, timestamp: kstNowIso() };
  }
}
