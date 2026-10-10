import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiErrorResponse } from '../interfaces/api-response.interface';
import { BusinessException } from '../exceptions/business.exception';
import { kstNowIso } from '../utils/kst';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = '서버 내부 오류가 발생했습니다.';
    let details: unknown = undefined;

    if (exception instanceof BusinessException) {
      status = exception.getStatus();
      code = exception.errorCode;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
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
    } else {
      this.logger.error('Unhandled Exception:', exception);
    }

    const payload: ApiErrorResponse = {
      success: false,
      error: { code, message, details },
      timestamp: kstNowIso(),
    };

    response.status(status).json(payload);
  }
}
