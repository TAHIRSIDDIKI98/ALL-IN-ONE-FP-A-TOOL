import { describe, expect, it } from 'vitest';
import { ApiClientError, createApiClient } from './client.js';

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

function fakeFetch(
  responder: (request: RecordedRequest) => { status: number; body: unknown },
): { fetchImpl: typeof fetch; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request: RecordedRequest = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : null,
    };
    calls.push(request);
    const result = responder(request);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const COMPANY: Record<string, unknown> = {
  companyId: '11111111-1111-4111-8111-111111111111',
  companyName: 'Wire Co',
  baseCurrency: 'USD',
  currencyScale: 2,
  calendarKind: '12month',
  periods: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      code: 'P01',
      label: 'P01 (Jan 2026)',
      fiscalYear: 2026,
      periodNo: 1,
      quarter: 1,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      isAdjustment: false,
    },
  ],
  entities: [{ id: '33333333-3333-4333-8333-333333333333', code: 'ENT-1', name: 'Wire Co HQ' }],
};

describe('WI-0019 browser API client (relative URLs, typed errors, string money)', () => {
  it('signs in through the sandbox token route without sending an Authorization header', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 201,
      body: { token: 'sandbox.jwt.token', tokenType: 'sandbox-hmac', expiresInSeconds: 3600 },
    }));
    const client = createApiClient({ getToken: () => null, fetchImpl });

    const minted = await client.signInSandboxToken({
      email: 'owner@onefpa.test',
      displayName: 'Owner',
    });

    expect(minted.token).toBe('sandbox.jwt.token');
    expect(minted.expiresInSeconds).toBe(3600);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/session/sandbox-token');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['authorization']).toBeUndefined();
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      email: 'owner@onefpa.test',
      displayName: 'Owner',
      ttlSeconds: 3600,
    });
  });

  it('refuses to call a protected route without a token, and never touches the network', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: {} }));
    const client = createApiClient({ getToken: () => null, fetchImpl });

    let caught: unknown = null;
    try {
      await client.getSessionWorkspace();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiClientError);
    expect((caught as ApiClientError).code).toBe('SESSION_REQUIRED');
    expect((caught as ApiClientError).httpStatus).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('sends the bearer token and returns the workspace with money-safe period data intact', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        authenticated: true,
        identity: { email: 'owner@onefpa.test', displayName: 'Owner' },
        companies: [{ id: COMPANY['companyId'], name: 'Wire Co', baseCurrency: 'USD' }],
        workspace: COMPANY,
      },
    }));
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    const session = await client.getSessionWorkspace();

    expect(session.authenticated).toBe(true);
    expect(session.companies[0]?.name).toBe('Wire Co');
    expect(session.workspace?.periods[0]?.code).toBe('P01');
    expect(session.workspace?.periods[0]?.startDate).toBe('2026-01-01');
    expect(calls[0]?.headers['authorization']).toBe('Bearer token-123');
    expect(calls[0]?.headers['accept']).toBe('application/json');
  });

  it('maps a typed server envelope onto ApiClientError instead of inventing a message', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 403,
      body: {
        error: {
          code: 'TENANT_FORBIDDEN',
          userMessage: 'You are not a member of that company.',
          httpStatus: 403,
          details: { companyId: COMPANY['companyId'] },
        },
      },
    }));
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    let caught: unknown = null;
    try {
      await client.getCompanyWorkspace(String(COMPANY['companyId']));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiClientError);
    const error = caught as ApiClientError;
    expect(error.code).toBe('TENANT_FORBIDDEN');
    expect(error.httpStatus).toBe(403);
    expect(error.message).toBe('You are not a member of that company.');
    expect(error.details['companyId']).toBe(COMPANY['companyId']);
  });

  it('creates a company through the API and URL-encodes company ids on later reads', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 201, body: COMPANY }));
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    const created = await client.createCompany({
      companyName: 'Wire Co',
      baseCurrency: 'USD',
      calendarKind: '12month',
      fiscalYear: 2026,
      entityCode: 'ENT-1',
      entityName: 'Wire Co HQ',
    });
    expect(created.companyId).toBe(COMPANY['companyId']);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('/api/setup/company');

    await client.getCompanyWorkspace('id with space');
    expect(calls[1]?.url).toBe('/api/companies/id%20with%20space/workspace');
  });

  it('surfaces a non-JSON failure as a typed INTERNAL_ERROR rather than throwing a parse error', async () => {
    const fetchImpl = (async () =>
      new Response('<html>gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch;
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    let caught: unknown = null;
    try {
      await client.getSessionWorkspace();
    } catch (error) {
      caught = error;
    }
    // A gateway HTML body is not JSON, so the client reports a typed envelope rather than a SyntaxError.
    expect(caught).toBeInstanceOf(ApiClientError);
    expect((caught as ApiClientError).code).toBe('INTERNAL_ERROR');
    expect((caught as ApiClientError).httpStatus).toBe(502);
  });
});
