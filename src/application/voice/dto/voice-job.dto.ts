import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import {
  VoiceJobError,
  VoiceJobStatus,
} from '../../../domain/voice/models/voice-job';
import { VoiceRouteRecommendResponseDto } from './voice-route-recommend-response.dto';

export class VoiceJobIdParamDto {
  @ApiProperty({
    description: '음성 작업 ID',
    example: '0b6d3a2e-6b0e-4d9a-9a52-1d3f0c1b2a4e',
  })
  @IsUUID()
  jobId!: string;
}

export interface VoiceJobSubmitResponseDto {
  jobId: string;
  status: 'QUEUED';
}

export interface VoiceJobStatusResponseDto {
  jobId: string;
  status: VoiceJobStatus;
  /** `COMPLETED`일 때만 */
  result?: VoiceRouteRecommendResponseDto;
  /** `FAILED`일 때만 (HTTP 오류 응답과 같은 코드와 메시지) */
  error?: VoiceJobError;
}
