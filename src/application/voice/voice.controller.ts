import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import { ClerkAuthGuard } from '../../infra/auth/clerk-auth.guard';
import {
  VoiceRouteRecommendRequestDto,
  VoiceRouteRecommendResponseDto,
} from './dto';
import { UploadedAudioFile, VoiceService } from './voice.service';

@ApiTags('Voice')
@ApiBearerAuth('clerk-auth')
@Controller(['v1/voice', 'api/v1/voice'])
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

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
  ): Promise<VoiceRouteRecommendResponseDto> {
    return this.voiceService.recommendRouteByVoice(user.id, file, dto);
  }
}
