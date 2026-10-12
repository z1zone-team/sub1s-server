import { HttpException, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../exceptions/business.exception';

export interface ErrorInfo {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  /** HttpException이 아닌 예상하지 못한 오류인지 */
  unexpected: boolean;
}

/**
 * 예외를 API 오류 응답의 상태, 코드, 메시지로 바꾼다. HTTP 응답(`GlobalExceptionFilter`)과
 * 큐 작업의 오류(`voice_failed`)가 같은 코드와 메시지를 쓰도록 한 곳에 둔다
 */
export function toErrorInfo(exception: unknown): ErrorInfo {
  if (exception instanceof BusinessException) {
    return {
      status: exception.getStatus(),
      code: exception.errorCode,
      message: exception.message,
      details: exception.details,
      unexpected: false,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const res = exception.getResponse();
    let code = 'HTTP_ERROR';
    let message = exception.message;
    let details: unknown = undefined;

    if (typeof res === 'string') {
      message = res;
      code = status === 401 ? 'UNAUTHORIZED' : 'HTTP_ERROR';
    } else if (typeof res === 'object' && res !== null) {
      const errObj = res as Record<string, unknown>;
      code =
        typeof errObj.code === 'string'
          ? errObj.code
          : status === 401
            ? 'UNAUTHORIZED'
            : status === 400
              ? 'INVALID_REQUEST_PAYLOAD'
              : 'HTTP_ERROR';
      message =
        typeof errObj.message === 'string'
          ? errObj.message
          : Array.isArray(errObj.message)
            ? errObj.message.join(', ')
            : exception.message;
      details = errObj.message;
    }
    return { status, code, message, details, unexpected: false };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_SERVER_ERROR',
    message: '서버 내부 오류가 발생했습니다.',
    unexpected: true,
  };
}
