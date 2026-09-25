import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { UniqueViolationError } from '../application/pricing-store.js';
import { DomainError, type DomainErrorCode } from '../domain/domain-error.js';

export const CORRELATION_HEADER = 'X-Correlation-Id';

const DOMAIN_STATUS: Record<DomainErrorCode, number> = {
  VALIDATION_FAILED: 400,
  NO_CHANGE: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  SELF_APPROVAL: 403,
  STALE_REVISION: 409,
  VERSION_NOT_CURRENT: 409,
  ALREADY_DECIDED: 409,
  REQUEST_EXISTS: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  NO_CURRENT_APPROVAL: 409,
  TEMPORARILY_UNAVAILABLE: 503,
};

const HTTP_CODES: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
};

interface ErrorDescription {
  status: number;
  code: string;
  message: string;
}

function httpMessage(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === 'string') return body;
  const message = 'message' in body ? body.message : exception.message;
  return Array.isArray(message) ? message.join('; ') : String(message);
}

/** Every error leaves the API as { code, message, correlationId }. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, code, message } = this.describe(exception);
    response.status(status).json({ code, message, correlationId: response.getHeader(CORRELATION_HEADER) });
  }

  private describe(exception: unknown): ErrorDescription {
    if (exception instanceof DomainError) {
      return { status: DOMAIN_STATUS[exception.code], code: exception.code, message: exception.message };
    }
    if (exception instanceof UniqueViolationError) {
      return {
        status: 409,
        code: 'CONFLICT',
        message: 'The write conflicted with existing data. Reload and try again.',
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { status, code: HTTP_CODES[status] ?? 'HTTP_ERROR', message: httpMessage(exception) };
    }
    this.logger.error(exception);
    return { status: 500, code: 'INTERNAL_ERROR', message: 'Unexpected server error.' };
  }
}
