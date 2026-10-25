import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import { AppException } from '../errors/app.exception.js';

const DEFAULT_ERROR_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'validation_failed',
  [HttpStatus.UNAUTHORIZED]: 'unauthorized',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'not_found',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'unprocessable_entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'too_many_requests',
};

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  retry_after_seconds?: number;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toErrorBody(exception);
    const retryAfter = this.getRetryAfter(exception);

    if (retryAfter !== undefined) {
      response.setHeader('Retry-After', String(retryAfter));
      body.retry_after_seconds = retryAfter;
    }

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toErrorBody(exception: unknown): ErrorBody {
    if (!(exception instanceof HttpException)) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'internal_error',
        message: 'Internal server error',
      };
    }

    const statusCode = exception.getStatus();
    const code = DEFAULT_ERROR_CODES[statusCode] ?? 'http_error';
    const exceptionResponse = exception.getResponse();

    if (typeof exceptionResponse === 'string') {
      return { statusCode, code, message: exceptionResponse };
    }

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const responseBody = exceptionResponse as Record<string, unknown>;
      const message = responseBody.message;

      return {
        statusCode,
        code: typeof responseBody.code === 'string' ? responseBody.code : code,
        message: Array.isArray(message)
          ? message.map(String).join(', ')
          : typeof message === 'string'
            ? message
            : exception.message,
      };
    }

    return { statusCode, code, message: exception.message };
  }

  private getRetryAfter(exception: unknown): number | undefined {
    if (exception instanceof AppException) {
      return exception.retryAfterSeconds;
    }
    return undefined;
  }
}
