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

  it('asks for statements with period scoping and passes money strings through untouched', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        companyId: COMPANY['companyId'],
        range: { fromPeriodCode: 'P01', throughPeriodCode: 'P03', fiscalYear: 2026 },
        pnl: { revenue: '1000.00', netIncome: '1000.00' },
        balanceSheet: { totalAssets: '1000.00', isBalanced: true },
        cashFlow: { endingCash: '1000.00' },
        retainedEarnings: { opening: '0.00', closingTotal: '1000.00', rollForwardValid: true },
        articulation: { valid: true, checks: [] },
        sources: [{ sourceFilename: 'cash_sale.csv', sourceHash: 'a'.repeat(64) }],
      },
    }));
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    const statements = await client.getStatements(String(COMPANY['companyId']), {
      period: 'P03',
      fiscalYear: 2026,
    });

    expect(calls[0]?.url).toBe(
      `/api/companies/${COMPANY['companyId']}/statements?period=P03&year=2026`,
    );
    expect(statements.pnl.revenue).toBe('1000.00');
    expect(typeof statements.pnl.netIncome).toBe('string');
    expect(statements.articulation.valid).toBe(true);
    expect(statements.sources[0]?.sourceFilename).toBe('cash_sale.csv');
  });

  it('previews an import on the company-scoped route with only the CSV and string money', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        companyId: '11111111-1111-4111-8111-111111111111',
        rowsIn: 3,
        entryCount: 1,
        importedCount: 2,
        quarantinedCount: 1,
        duplicatesDetected: 0,
        totalDebits: '2500.00',
        totalCredits: '2500.00',
        imported: [
          {
            rowNo: 2,
            entryRef: 'JE-1',
            postingDate: '2026-01-04',
            accountCode: '001200',
            description: 'Bank',
            debit: '2500.00',
            credit: '0.00',
          },
        ],
        quarantined: [{ rowNo: 3, reason: 'UNMAPPED_ACCOUNT:9999' }],
      },
    }));
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    const preview = await client.previewImport('11111111-1111-4111-8111-111111111111', {
      csvText: 'entry_ref,date,account_code\nJE-1,2026-01-04,001200\n',
    });

    expect(calls[0]?.url).toBe(
      '/api/companies/11111111-1111-4111-8111-111111111111/import/preview',
    );
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['authorization']).toBe('Bearer token-123');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      csvText: 'entry_ref,date,account_code\nJE-1,2026-01-04,001200\n',
    });
    expect(preview.importedCount + preview.quarantinedCount).toBe(preview.rowsIn);
    expect(preview.totalDebits).toBe('2500.00');
    expect(preview.quarantined[0]?.reason).toBe('UNMAPPED_ACCOUNT:9999');
  });

  it('commits an import on the company-scoped route and keeps the row accounting verbatim', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 201,
      body: {
        batchId: '44444444-4444-4444-8444-444444444444',
        replacedBatchId: '55555555-5555-4555-8555-555555555555',
        rowsIn: 11,
        importedCount: 2,
        quarantinedCount: 9,
        duplicatesDetected: 0,
        totalDebits: '2500.00',
        totalCredits: '2500.00',
        entryCount: 1,
        sourceHash: 'b'.repeat(64),
        quarantined: [{ rowNo: 4, reason: 'UNBALANCED_ENTRY:JE-2' }],
      },
    }));
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    const committed = await client.commitImport('11111111-1111-4111-8111-111111111111', {
      kind: 'actuals',
      sourceFilename: 'erp_mixed_gl.csv',
      csvText: 'x',
    });

    expect(calls[0]?.url).toBe(
      '/api/companies/11111111-1111-4111-8111-111111111111/import/commit',
    );
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      kind: 'actuals',
      sourceFilename: 'erp_mixed_gl.csv',
      csvText: 'x',
    });
    expect(committed.importedCount + committed.quarantinedCount).toBe(committed.rowsIn);
    expect(committed.replacedBatchId).toBe('55555555-5555-4555-8555-555555555555');
    expect(committed.entryCount).toBe(1);
  });

  it('reads the trial balance with optional period scoping and preserves leading-zero account codes', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        companyId: '11111111-1111-4111-8111-111111111111',
        throughPeriodCode: 'P03',
        rows: [
          {
            accountId: '66666666-6666-4666-8666-666666666666',
            code: '001200',
            name: 'Operating bank account',
            type: 'asset',
            normalSide: 'debit',
            statementLineKey: 'bs.cash',
            totalDebit: '2500.00',
            totalCredit: '0.00',
            naturalActivity: '2500.00',
            sheetContribution: '2500.00',
          },
        ],
        totalDebit: '2500.00',
        totalCredit: '2500.00',
        isBalanced: true,
        unbalancedEntryIds: [],
        sources: [
          {
            batchId: '44444444-4444-4444-8444-444444444444',
            sourceFilename: 'erp_mixed_gl.csv',
            sourceHash: 'c'.repeat(64),
            importedAt: '2026-11-25T12:00:00.000Z',
          },
        ],
      },
    }));
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    const scoped = await client.getTrialBalance('11111111-1111-4111-8111-111111111111', {
      period: 'P03',
    });
    const unscoped = await client.getTrialBalance('11111111-1111-4111-8111-111111111111');

    expect(calls[0]?.url).toBe('/api/companies/11111111-1111-4111-8111-111111111111/trial-balance?period=P03');
    expect(calls[1]?.url).toBe('/api/companies/11111111-1111-4111-8111-111111111111/trial-balance');
    expect(scoped.rows[0]?.code).toBe('001200');
    expect(typeof scoped.rows[0]?.naturalActivity).toBe('string');
    expect(scoped.isBalanced).toBe(true);
    expect(unscoped.sources[0]?.sourceFilename).toBe('erp_mixed_gl.csv');
  });

  it('drills to source with the account code URL-encoded and reports the typed server failure', async () => {
    const drillBody = {
      companyId: '11111111-1111-4111-8111-111111111111',
      accountCode: '001200',
      accountName: 'Operating bank account',
      throughPeriodCode: 'P03',
      rows: [
        {
          entryId: '77777777-7777-4777-8777-777777777777',
          entryDate: '2026-01-04',
          sourceRef: 'JE-1',
          periodCode: 'P01',
          debit: '2500.00',
          credit: '0.00',
          batchId: '44444444-4444-4444-8444-444444444444',
          sourceFilename: 'erp_mixed_gl.csv',
          sourceHash: 'd'.repeat(64),
          rowNo: 2,
          rawCells: ['JE-1', '2026-01-04', '001200', 'Bank', '2500.00', ''],
        },
      ],
      totalDebit: '2500.00',
      totalCredit: '0.00',
      naturalActivity: '2500.00',
    };
    let call = 0;
    const { fetchImpl, calls } = fakeFetch(() => {
      call += 1;
      return call === 1
        ? { status: 200, body: drillBody }
        : {
            status: 422,
            body: {
              error: {
                code: 'PERIOD_NOT_FOUND',
                userMessage: 'No fiscal period matches P99.',
                httpStatus: 422,
                details: { period: 'P99' },
              },
            },
          };
    });
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    const drill = await client.getAccountDrilldown(
      '11111111-1111-4111-8111-111111111111',
      '001200',
      { period: 'P03' },
    );

    expect(calls[0]?.url).toBe(
      '/api/companies/11111111-1111-4111-8111-111111111111/accounts/001200/drill?period=P03',
    );
    expect(drill.totalDebit).toBe('2500.00');
    expect(drill.rows[0]?.rawCells).toHaveLength(6);
    expect(drill.rows[0]?.rowNo).toBe(2);

    let caught: unknown = null;
    try {
      await client.getAccountDrilldown('11111111-1111-4111-8111-111111111111', '001200', {
        period: 'P99',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiClientError);
    expect((caught as ApiClientError).code).toBe('PERIOD_NOT_FOUND');
    expect((caught as ApiClientError).httpStatus).toBe(422);
  });
});
