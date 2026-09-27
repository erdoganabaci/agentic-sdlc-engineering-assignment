import type {
  DecisionInput,
  MortgageApplication,
  Page,
  RequestDetail,
  RequestStatus,
  RequestSummary,
  User,
  VersionContent,
} from './types';
import { trackPending } from './pending-requests';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const UNREADABLE = Symbol('unreadable response body');
const UNREADABLE_MESSAGE = 'The server response could not be read. Submit again to confirm the result.';

/** status 0 means the outcome is unknown (network failure), so a retry must reuse the same idempotency key. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

function send<T>(path: string, userId: string | null, init: RequestInit = {}): Promise<T> {
  return trackPending(request<T>(path, userId, init));
}

async function request<T>(path: string, userId: string | null, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  if (userId) headers.set('X-User-Id', userId);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_URL}${path}`, { ...init, headers }).catch(() => {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  });
  const body: unknown = await response.json().catch(() => UNREADABLE);
  if (response.ok) {
    // The server may have acted; report an unknown outcome so creation retries keep their idempotency key.
    if (body === UNREADABLE) throw new ApiError(0, 'UNREADABLE_RESPONSE', UNREADABLE_MESSAGE);
    return body as T;
  }
  const error = (body === UNREADABLE || body === null ? {} : body) as { code?: string; message?: string };
  throw new ApiError(
    response.status,
    error.code ?? 'HTTP_ERROR',
    error.message ?? `Request failed (${response.status}).`,
  );
}

const post = (body: unknown, headers?: HeadersInit): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers,
});

export const fetchDemoUsers = () => send<User[]>('/demo/users', null);

/** All calls act as the given demo user; the server resolves the role. */
export function apiFor(userId: string) {
  return {
    applications: () => send<MortgageApplication[]>('/applications', userId),
    listRequests: (status?: RequestStatus) =>
      send<Page<RequestSummary>>(`/requests?pageSize=100${status ? `&status=${status}` : ''}`, userId),
    getRequest: (requestId: string) => send<RequestDetail>(`/requests/${requestId}`, userId),
    createRequest: (body: VersionContent & { applicationId: string }, idempotencyKey: string) =>
      send<{ requestId: string }>('/requests', userId, post(body, { 'Idempotency-Key': idempotencyKey })),
    reviseRequest: (requestId: string, body: VersionContent & { expectedVersion: number; expectedRevision: number }) =>
      send<{ versionNumber: number }>(`/requests/${requestId}/versions`, userId, post(body)),
    decide: (requestId: string, versionNumber: number, body: DecisionInput) =>
      send<{ decisionId: string }>(`/requests/${requestId}/versions/${versionNumber}/decision`, userId, post(body)),
  };
}

export type Api = ReturnType<typeof apiFor>;
