/**
 * Typed browser API client (MASTER_PROMPT §3.2, §5.2, §9.1).
 *
 * - Relative URLs only: the browser talks to its own origin and the dev server proxies `/api` to
 *   the spine API, so nothing in the bundle can reach a hard-coded host.
 * - Money crosses this boundary as canonical decimal STRINGS; the client never parses money into a
 *   JS number (§5.2 E11).
 * - Every non-2xx response becomes an `ApiClientError` carrying the server's typed envelope, so a
 *   screen can render the real error code instead of inventing one.
 */

export interface ApiErrorEnvelope {
  readonly code: string;
  readonly userMessage: string;
  readonly httpStatus: number;
  readonly details: Readonly<Record<string, unknown>>;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(envelope: ApiErrorEnvelope) {
    super(envelope.userMessage);
    this.name = 'ApiClientError';
    this.code = envelope.code;
    this.httpStatus = envelope.httpStatus;
    this.details = envelope.details;
  }
}

export interface SessionCompany {
  readonly id: string;
  readonly name: string;
  readonly baseCurrency: string;
}

export interface WorkspacePeriod {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly fiscalYear: number;
  readonly periodNo: number;
  readonly quarter: number;
  readonly startDate: string;
  readonly endDate: string;
  readonly isAdjustment: boolean;
}

export interface CompanyWorkspace {
  readonly companyId: string;
  readonly companyName: string;
  readonly baseCurrency: string;
  readonly currencyScale: number;
  readonly calendarKind: string;
  readonly periods: readonly WorkspacePeriod[];
  readonly entities: readonly { readonly id: string; readonly code: string; readonly name: string }[];
}

export interface SessionWorkspace {
  readonly authenticated: boolean;
  readonly identity: { readonly email: string; readonly displayName: string };
  readonly companies: readonly SessionCompany[];
  readonly workspace: CompanyWorkspace | null;
}

export interface CreateCompanyRequest {
  readonly companyName: string;
  readonly baseCurrency: string;
  readonly calendarKind: string;
  readonly fiscalYear: number;
  readonly entityCode: string;
  readonly entityName: string;
}

export interface SandboxTokenResponse {
  readonly token: string;
  readonly tokenType: string;
  readonly expiresInSeconds: number;
}

export interface ApiClientOptions {
  /** Token for the current session; returns null when the user is not signed in. */
  readonly getToken: () => string | null;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

export interface ApiClient {
  signInSandboxToken(request: {
    readonly email: string;
    readonly displayName: string;
  }): Promise<SandboxTokenResponse>;
  getSessionWorkspace(): Promise<SessionWorkspace>;
  createCompany(request: CreateCompanyRequest): Promise<CompanyWorkspace>;
  getCompanyWorkspace(companyId: string): Promise<CompanyWorkspace>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toApiError(status: number, body: unknown): ApiClientError {
  const envelope = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
  const code = envelope !== null && typeof envelope['code'] === 'string' ? envelope['code'] : 'INTERNAL_ERROR';
  const userMedia =
    envelope !== null && typeof envelope['userMessage'] === 'string'
      ? envelope['userMessage']
      : 'The server rejected the request.';
  const details = envelope !== null && isRecord(envelope['details']) ? envelope['details'] : {};
  return new ApiClientError({ code, userMessage: userMedia, httpStatus: status, details });
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl ?? '';
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    requireAuth = true,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (requireAuth) {
      const token = options.getToken();
      if (token === null || token.length === 0) {
        throw new ApiClientError({
          code: 'SESSION_REQUIRED',
          userMessage: 'Sign in before loading company data.',
          httpStatus: 401,
          details: {},
        });
      }
      headers['authorization'] = `Bearer ${token}`;
    }

    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // A proxy or gateway can answer with HTML; treat it as "no typed envelope" and let the
        // status decide the error code instead of throwing a JSON SyntaxError at the screen.
        parsed = null;
      }
    }
    if (!response.ok) {
      throw toApiError(response.status, parsed);
    }
    return parsed as T;
  }

  return {
    signInSandboxToken: (requestBody) =>
      request<SandboxTokenResponse>(
        'POST',
        '/api/session/sandbox-token',
        { email: requestBody.email, displayName: requestBody.displayName, ttlSeconds: 3600 },
        false,
      ),
    getSessionWorkspace: () => request<SessionWorkspace>('GET', '/api/session/workspace'),
    createCompany: (companyRequest) =>
      request<CompanyWorkspace>('POST', '/api/setup/company', companyRequest),
    getCompanyWorkspace: (companyId) =>
      request<CompanyWorkspace>('GET', `/api/companies/${encodeURIComponent(companyId)}/workspace`),
  };
}
