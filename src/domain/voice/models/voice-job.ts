import { RouteMode } from '../../subway/models/route';

/** 음성 요청에서 큐 작업으로 함께 넘기는 선택 입력 */
export interface VoiceJobOptions {
  preferredMode?: RouteMode;
  transcriptHint?: string;
  /** 출발지를 말하지 않았을 때 쓰는 현재 위치 */
  lat?: number;
  lng?: number;
}

/** `voice-route` 큐 작업의 입력. 오디오는 base64로 담고 STT가 끝나면 비운다 */
export interface VoiceJobData {
  userId: string;
  filename: string;
  audioBase64: string;
  options: VoiceJobOptions;
  submittedAt: string;
}

export interface VoiceJobError {
  code: string;
  message: string;
  status: number;
}

/**
 * 큐 작업의 결과. 역을 찾지 못하는 것 같은 업무 오류도 작업을 실패시키지 않고 `ok: false`로 담아
 * 오류 코드와 메시지를 그대로 보관한다(BullMQ의 실패 사유는 문자열 하나뿐이라서)
 */
export type VoiceJobOutcome<TResult> =
  | { ok: true; result: TResult }
  | { ok: false; error: VoiceJobError };

export type VoiceJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
