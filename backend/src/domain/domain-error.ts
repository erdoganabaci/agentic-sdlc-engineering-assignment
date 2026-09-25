export type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'NO_CHANGE'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'SELF_APPROVAL'
  | 'STALE_REVISION'
  | 'VERSION_NOT_CURRENT'
  | 'ALREADY_DECIDED'
  | 'REQUEST_EXISTS'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'NO_CURRENT_APPROVAL'
  | 'TEMPORARILY_UNAVAILABLE';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
