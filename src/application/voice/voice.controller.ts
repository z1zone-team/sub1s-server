import {
  Body,
  Controller,
  Get,
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
  VoiceRouteRecommendRequestDto,
  VoiceRouteRecommendResponseDto,
} from './dto';
import { UploadedAudioFile, VoiceService } from './voice.service';

@ApiTags('Voice')
@ApiBearerAuth('clerk-auth')
@Controller(['v1/voice', 'api/v1/voice'])
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

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

  @Post('route-recommend')
  @UseGuards(ClerkAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
      },
    }),
  )
  @ApiOperation({
    summary: 'AI 음성 경로 추천 및 자연어 브리핑',
    description:
      '사용자의 음성 파일(최대 5MB, m4a/wav/mp3/webm)을 업로드받아 STT -> NLU 가드레일 슬롯필링 -> 다익스트라 최적 경로 계산 -> 자연어 브리핑 및 TTS 오디오 URL을 생성합니다. (5초 멱등성 락 적용)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '오디오 파일 및 옵션',
    type: VoiceRouteRecommendRequestDto,
  })
  @SwaggerResponse({ status: 201, description: '음성 경로 추천 성공' })
  @SwaggerResponse({ status: 400, description: '오디오 파일 누락 또는 미지원 포맷' })
  @SwaggerResponse({ status: 429, description: '5초 이내 중복 연타 요청 차단' })
  async recommendRoute(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedAudioFile | undefined,
    @Body() dto: VoiceRouteRecommendRequestDto,
  ): Promise<ApiResponse<VoiceRouteRecommendResponseDto>> {
    const data = await this.voiceService.recommendRouteByVoice(user.id, file, dto);
    return {
      success: true,
      data,
      timestamp: kstNowIso(),
    };
  }
}
