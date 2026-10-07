import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import { ClerkAuthGuard } from '../../infra/auth/clerk-auth.guard';
import {
  VoiceRouteRecommendRequestDto,
  VoiceRouteRecommendResponseDto,
} from './dto';
import { UploadedAudioFile, VoiceService } from './voice.service';

@Controller('api/v1/voice')
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
  async recommendRoute(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedAudioFile | undefined,
    @Body() dto: VoiceRouteRecommendRequestDto,
  ): Promise<VoiceRouteRecommendResponseDto> {
    return this.voiceService.recommendRouteByVoice(user.id, file, dto);
  }
}
