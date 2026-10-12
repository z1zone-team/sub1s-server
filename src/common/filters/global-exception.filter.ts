import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiErrorResponse } from '../interfaces/api-response.interface';
import { toErrorInfo } from '../utils/error-info';
import { kstNowIso } from '../utils/kst';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const { status, code, message, details, unexpected } =
      toErrorInfo(exception);
    if (unexpected) {
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
