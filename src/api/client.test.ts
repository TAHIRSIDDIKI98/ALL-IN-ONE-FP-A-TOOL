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

  it('reads the chart of accounts and imports a chart CSV through the company-scoped routes', async () => {
    const account = {
      code: '001200',
      name: 'Operating bank account',
      type: 'asset',
      normalSide: 'debit',
      isContra: false,
      isPostable: true,
      statementLineKey: 'bs.asset.cash',
      parentCode: null,
      active: true,
      version: 1,
    };
    let call = 0;
    const { fetchImpl, calls } = fakeFetch(() => {
      call += 1;
      return call === 1
        ? { status: 200, body: { companyId: '11111111-1111-4111-8111-111111111111', accounts: [account] } }
        : {
            status: 201,
            body: {
              companyId: '11111111-1111-4111-8111-111111111111',
              rowCount: 1,
              inserted: 1,
              updated: 0,
              accounts: [account],
            },
          };
    });
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    const chart = await client.getChart('11111111-1111-4111-8111-111111111111');
    const imported = await client.importChart('11111111-1111-4111-8111-111111111111', {
      csvText: 'code,name,type,normal_side,statement_line_key\n001200,Bank,asset,debit,bs.asset.cash\n',
    });

    expect(calls[0]?.url).toBe('/api/companies/11111111-1111-4111-8111-111111111111/accounts');
    expect(calls[1]?.url).toBe(
      '/api/companies/11111111-1111-4111-8111-111111111111/chart/import',
    );
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({
      csvText: 'code,name,type,normal_side,statement_line_key\n001200,Bank,asset,debit,bs.asset.cash\n',
    });
    // Leading zeros survive the wire in both directions.
    expect(chart.accounts[0]?.code).toBe('001200');
    expect(imported.inserted).toBe(1);
    expect(imported.rowCount).toBe(1);
    expect(imported.accounts[0]?.statementLineKey).toBe('bs.asset.cash');
  });

  it('reads and imports a fiscal-year budget through the company-scoped routes', async () => {
    const budget = {
      companyId: '11111111-1111-4111-8111-111111111111',
      fiscalYear: 2026,
      scenarioId: null,
      scenarioName: null,
      planVersionId: null,
      versionNo: null,
      lineCount: 0,
      totalAmount: '0.00',
      lines: [],
      accounts: [],
    };
    let call = 0;
    const { fetchImpl, calls } = fakeFetch(() => {
      call += 1;
      return call === 1
        ? { status: 200, body: budget }
        : { status: 201, body: { ...budget, rowCount: 1, lineCount: 1, totalAmount: '12500.00' } };
    });
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    await client.getBudget('11111111-1111-4111-8111-111111111111', { fiscalYear: 2026 });
    const imported = await client.importBudget('11111111-1111-4111-8111-111111111111', {
      csvText: 'account_code,period,amount\n4000,P01,12500.00\n',
      fiscalYear: 2026,
      sourceFilename: 'fy2026-budget.csv',
    });

    expect(calls[0]?.url).toBe(
      '/api/companies/11111111-1111-4111-8111-111111111111/budget?year=2026',
    );
    expect(calls[1]?.url).toBe(
      '/api/companies/11111111-1111-4111-8111-111111111111/budget/import',
    );
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({
      csvText: 'account_code,period,amount\n4000,P01,12500.00\n',
      fiscalYear: 2026,
      sourceFilename: 'fy2026-budget.csv',
    });
    expect(imported.totalAmount).toBe('12500.00');
    expect(imported.rowCount).toBe(1);
  });

  it('reads Budget-vs-Actual for a period without inventing a plan for unplanned accounts', async () => {
    const report = {
      companyId: '11111111-1111-4111-8111-111111111111',
      fiscalYear: 2026,
      throughPeriodCode: 'P04',
      scenarioId: '22222222-2222-4222-8222-222222222222',
      scenarioName: 'Budget FY2026',
      planVersionId: '33333333-3333-4333-8333-333333333333',
      versionNo: 2,
      hasPlan: true,
      rows: [
        {
          accountCode: '4000',
          accountName: 'Service revenue',
          accountType: 'revenue',
          actual: '750.25',
          plan: '38000.00',
          varianceAmount: '-37249.75',
          variancePctKind: 'computed',
          variancePctFormatted: '-98.03%',
          favorability: 'unfavorable',
        },
        {
          accountCode: '1000',
          accountName: 'Cash',
          accountType: 'asset',
          actual: '750.25',
          plan: null,
          varianceAmount: null,
          variancePctKind: 'null',
          variancePctFormatted: null,
          favorability: 'na',
        },
      ],
      totals: {
        actual: '1500.50',
        plan: '38000.00',
        unplannedActual: '750.25',
        varianceAmount: '-37249.75',
        plannedRows: 1,
        unplannedRows: 1,
        favorable: 0,
        unfavorable: 1,
        neutral: 0,
        na: 1,
      },
      byType: [{ accountType: 'revenue', actual: '750.25', plan: '38000.00', varianceAmount: '-37249.75' }],
    };
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: report }));
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    const bva = await client.getBva('11111111-1111-4111-8111-111111111111', {
      period: 'P04',
      fiscalYear: 2026,
    });

    expect(calls[0]?.url).toBe(
      '/api/companies/11111111-1111-4111-8111-111111111111/bva?period=P04&year=2026',
    );
    expect(bva.rows[0]?.varianceAmount).toBe('-37249.75');
    expect(bva.rows[1]?.plan).toBeNull();
    expect(bva.rows[1]?.favorability).toBe('na');
    expect(bva.totals.unplannedActual).toBe('750.25');
  });

  it('surfaces a rejected chart file with its row-level issues so the screen can show them verbatim', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 422,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          userMessage: 'The chart file has 2 rejected row(s); nothing was written.',
          httpStatus: 422,
          details: { issues: ['row 3: INVALID_TYPE:bank', 'row 4: DUPLICATE_CODE:1000'] },
        },
      },
    }));
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    let caught: unknown = null;
    try {
      await client.importChart('11111111-1111-4111-8111-111111111111', { csvText: 'code\n1000' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiClientError);
    expect((caught as ApiClientError).code).toBe('VALIDATION_FAILED');
    expect((caught as ApiClientError).details['issues']).toEqual([
      'row 3: INVALID_TYPE:bank',
      'row 4: DUPLICATE_CODE:1000',
    ]);
  });

  it('loads the canonical board pack from the server with period/year on the URL', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        companyId: COMPANY['companyId'],
        companyName: 'Wire Co',
        baseCurrency: 'USD',
        range: { fromPeriodCode: 'P01', throughPeriodCode: 'P04', fiscalYear: 2026 },
        rows: [
          {
            section: 'cover',
            key: 'statement:pnl.revenue',
            label: 'Revenue (YTD)',
            value: '1234.56',
            detail: 'Year to date P01 to P04, FY2026',
          },
        ],
        articulation: { valid: true, checks: [] },
        sources: [],
        hasPlan: false,
        basis: 'Year to date P01 to P04, FY2026; plan basis: no current plan version',
        disclosure: 'All figures are engine output.',
        bva: {
          companyId: COMPANY['companyId'],
          fiscalYear: 2026,
          throughPeriodCode: 'P04',
          scenarioId: null,
          scenarioName: null,
          planVersionId: null,
          versionNo: null,
          hasPlan: false,
          rows: [],
          totals: {
            actual: '0.00',
            plan: '0.00',
            unplannedActual: '0.00',
            varianceAmount: '0.00',
            plannedRows: 0,
            unplannedRows: 0,
            favorable: 0,
            unfavorable: 0,
            neutral: 0,
            na: 0,
          },
          byType: [],
        },
      },
    }));
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    const pack = await client.getBoardPack(String(COMPANY['companyId']), {
      period: 'P04',
      fiscalYear: 2026,
    });

    expect(pack.rows[0]?.value).toBe('1234.56');
    expect(pack.rows[0]?.detail).toBe('Year to date P01 to P04, FY2026');
    expect(calls[0]?.url).toBe(
      `/api/companies/${String(COMPANY['companyId'])}/board-pack?period=P04&year=2026`,
    );
    expect(calls[0]?.headers['authorization']).toBe('Bearer token-123');
  });

  it('downloads a real binary artifact with the session token and a validated format', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const binaryFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(new Blob(['%PDF-1.3 board pack']), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    }) as unknown as typeof fetch;
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl: binaryFetch });

    const blob = await client.downloadBoardPack(String(COMPANY['companyId']), {
      period: 'P12',
      format: 'pdf',
    });

    expect(await blob.text()).toBe('%PDF-1.3 board pack');
    expect(calls[0]?.url).toBe(
      `/api/companies/${String(COMPANY['companyId'])}/board-pack/export?period=P12&format=pdf`,
    );
    expect(calls[0]?.headers['authorization']).toBe('Bearer token-123');

    const pptxBlob = await client.downloadBoardPack(String(COMPANY['companyId']), {
      period: 'P12',
      fiscalYear: 2026,
      format: 'pptx',
    });
    expect(await pptxBlob.text()).toBe('%PDF-1.3 board pack');
    expect(calls[1]?.url).toBe(
      `/api/companies/${String(COMPANY['companyId'])}/board-pack/export?period=P12&year=2026&format=pptx`,
    );
    expect(calls[1]?.headers['authorization']).toBe('Bearer token-123');
  });

  it('reads and commits versioned source mappings through tenant-scoped relative URLs', async () => {
    const report = {
      companyId: COMPANY['companyId'],
      sourceSystem: 'csv',
      effectiveFrom: '2026-11-25',
      mappings: [
        {
          sourceSystem: 'csv',
          sourceCode: 'BANK-EXT',
          accountCode: '1000',
          accountName: 'Operating bank',
          mappingVersion: 2,
          effectiveFrom: '2026-11-25',
          status: 'mapped',
          quarantineReason: null,
          targetConflict: false,
          rowCount: 3,
          sampleValues: ['receipt'],
        },
      ],
      availableAccounts: [{ code: '1000', name: 'Operating bank' }],
      mappedCount: 1,
      quarantinedCount: 0,
      unmappedCount: 0,
      conflictCount: 0,
    };
    const { fetchImpl, calls } = fakeFetch((request) => ({
      status: request.method === 'POST' ? 201 : 200,
      body: request.method === 'POST' ? { ...report, written: 1, unchanged: 0 } : report,
    }));
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    const loaded = await client.getCoaMappings(String(COMPANY['companyId']), { asOfDate: '2026-11-25' });
    expect(loaded.mappings[0]?.mappingVersion).toBe(2);
    expect(calls[0]?.url).toBe(
      `/api/companies/${String(COMPANY['companyId'])}/coa-mapping?asOfDate=2026-11-25`,
    );
    expect(calls[0]?.headers['authorization']).toBe('Bearer token-123');

    const committed = await client.commitCoaMappings(String(COMPANY['companyId']), {
      entries: [
        {
          sourceCode: 'BANK-EXT',
          status: 'mapped',
          accountCode: '1000',
          quarantineReason: null,
        },
      ],
    });
    expect(committed.written).toBe(1);
    expect(calls[1]?.url).toBe(
      `/api/companies/${String(COMPANY['companyId'])}/coa-mapping/commit`,
    );
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({
      entries: [
        {
          sourceCode: 'BANK-EXT',
          status: 'mapped',
          accountCode: '1000',
          quarantineReason: null,
        },
      ],
    });
  });

  it('surfaces a rejected mapping batch with the server typed code', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 422,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          userMessage: 'The mapping batch has 1 rejected row(s); nothing was written.',
          httpStatus: 422,
          details: { issues: ['row 1: UNKNOWN_ACCOUNT:9999'] },
        },
      },
    }));
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    await expect(
      client.commitCoaMappings(String(COMPANY['companyId']), {
        entries: [
          { sourceCode: 'BANK-EXT', status: 'mapped', accountCode: '9999', quarantineReason: null },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { issues: ['row 1: UNKNOWN_ACCOUNT:9999'] },
    });
  });

  it('maps a foreign-tenant export rejection onto the server typed code', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 403,
      body: {
        error: {
          code: 'TENANT_FORBIDDEN',
          userMessage: 'That company is outside your workspace.',
          httpStatus: 403,
          details: {},
        },
      },
    }));
    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    await expect(
      client.downloadBoardPack(String(COMPANY['companyId']), { period: 'P12', format: 'xlsx' }),
    ).rejects.toMatchObject({ code: 'TENANT_FORBIDDEN', httpStatus: 403 });
  });

  it('calls M2 planning endpoints with relative URLs and preserves string-only money (WI-0031)', async () => {
    const companyId = '11111111-1111-4111-8111-111111111111';
    let step = 0;
    const { fetchImpl, calls } = fakeFetch(() => {
      step += 1;
      if (step === 1) {
        return {
          status: 200,
          body: {
            companyId,
            scenarios: [
              {
                scenarioId: '22222222-2222-4222-8222-222222222222',
                name: 'Base Forecast',
                kind: 'forecast',
                currentVersionNo: 1,
                currentVersionLabel: 'Base Forecast v1',
              },
            ],
          },
        };
      }
      if (step === 2) {
        return {
          status: 200,
          body: {
            fiscalYear: 2026,
            currencyScale: 2,
            periods: ['P01'],
            lines: [],
            totalsByAccount: { '4000': '1000.00' },
            totalsByPeriod: { P01: '1000.00' },
            grandTotal: '1000.00',
          },
        };
      }
      if (step === 3) {
        return {
          status: 201,
          body: {
            scenarioId: '22222222-2222-4222-8222-222222222222',
            scenarioName: 'Base Forecast',
            scenarioKind: 'forecast',
            planVersionId: '33333333-3333-4333-8333-333333333333',
            versionNo: 1,
            lineCount: 1,
            grandTotal: '1000.00',
            totalsByAccount: { '4000': '1000.00' },
          },
        };
      }
      if (step === 4) {
        return {
          status: 200,
          body: {
            companyId,
            fiscalYear: 2026,
            scenarioName: 'Base Forecast',
            planVersionNo: 1,
            cutoffPeriod: 'P01',
            periods: ['P01', 'P02'],
            actualPeriods: ['P01'],
            forecastPeriods: ['P02'],
            rows: [],
            totalActual: '1200.00',
            totalForecast: '1100.00',
            totalFullHorizon: '2300.00',
            totalMissingCells: 0,
          },
        };
      }
      return {
        status: 200,
        body: {
          companyId,
          fiscalYear: 2026,
          baseScenarioName: 'Base Forecast',
          targetScenarioName: 'Upside Forecast',
          rows: [],
          totalBase: '4303.00',
          totalTarget: '5850.00',
          totalDelta: '1547.00',
        },
      };
    });

    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    const scenarios = await client.listPlanningScenarios(companyId);
    expect(calls[0]?.url).toBe(`/api/companies/${companyId}/planning/scenarios`);
    expect(scenarios.scenarios[0]?.name).toBe('Base Forecast');

    const preview = await client.previewDriverPlan(companyId, {
      fiscalYear: 2026,
      periods: ['P01'],
      drivers: [
        {
          kind: 'fixed',
          driverKey: 'd1',
          accountCode: '4000',
          assumptionLabel: 'Flat',
          amount: '1000.00',
        },
      ],
    });
    expect(calls[1]?.url).toBe(`/api/companies/${companyId}/planning/drivers/preview`);
    expect(typeof preview.grandTotal).toBe('string');
    expect(preview.grandTotal).toBe('1000.00');

    const committed = await client.commitDriverPlan(companyId, {
      fiscalYear: 2026,
      scenarioName: 'Base Forecast',
      scenarioKind: 'forecast',
      periods: ['P01'],
      drivers: [
        {
          kind: 'fixed',
          driverKey: 'd1',
          accountCode: '4000',
          assumptionLabel: 'Flat',
          amount: '1000.00',
        },
      ],
    });
    expect(calls[2]?.url).toBe(`/api/companies/${companyId}/planning/drivers/commit`);
    expect(committed.versionNo).toBe(1);

    const rf = await client.getRollingForecast(companyId, {
      year: 2026,
      scenario: 'Base Forecast',
      cutoffPeriod: 'P01',
    });
    expect(calls[3]?.url).toBe(
      `/api/companies/${companyId}/planning/rolling-forecast?year=2026&scenario=Base+Forecast&cutoffPeriod=P01`,
    );
    expect(rf.totalFullHorizon).toBe('2300.00');

    const cmp = await client.compareScenarios(companyId, {
      year: 2026,
      base: 'Base Forecast',
      target: 'Upside Forecast',
    });
    expect(calls[4]?.url).toBe(
      `/api/companies/${companyId}/planning/compare?year=2026&base=Base+Forecast&target=Upside+Forecast`,
    );
    expect(cmp.totalDelta).toBe('1547.00');
  });

  it('calls M2 workflow endpoints with relative URLs and typed payloads (WI-0034)', async () => {
    const companyId = '11111111-1111-4111-8111-111111111111';
    const versionId = '22222222-2222-4222-8222-222222222222';
    const taskId = '33333333-3333-4333-8333-333333333333';
    const commentId = '44444444-4444-4444-8444-444444444444';
    const notifId = '55555555-5555-4555-8555-555555555555';
    const userId = '66666666-6666-4666-8666-666666666666';

    let step = 0;
    const { fetchImpl, calls } = fakeFetch(() => {
      step += 1;
      if (step === 1) {
        return {
          status: 200,
          body: {
            companyId,
            actorRole: 'owner',
            members: [],
            planVersions: [],
            tasks: [],
            comments: [],
            notifications: [],
          },
        };
      }
      if (step === 2) {
        return {
          status: 201,
          body: { userId, email: 'rev@onefpa.test', displayName: 'Reviewer', role: 'reviewer' },
        };
      }
      if (step === 3 || step === 4) {
        return {
          status: step === 3 ? 201 : 200,
          body: {
            id: taskId,
            companyId,
            scenarioId: versionId,
            scenarioName: 'Base Forecast',
            planVersionId: versionId,
            versionNo: 1,
            versionLabel: 'Base Forecast v1',
            title: 'Approve Q1',
            status: step === 3 ? 'draft' : 'submitted',
            version: step === 3 ? 1 : 2,
            createdBy: userId,
            createdByName: 'Owner',
            assigneeId: null,
            assigneeName: null,
            submittedBy: step === 3 ? null : userId,
            submittedAt: step === 3 ? null : '2026-11-25T12:00:00.000Z',
            decidedBy: null,
            decidedByName: null,
            decidedAt: null,
            decisionReason: null,
            createdAt: '2026-11-25T12:00:00.000Z',
            updatedAt: '2026-11-25T12:00:00.000Z',
          },
        };
      }
      if (step === 5) {
        return {
          status: 201,
          body: {
            id: commentId,
            companyId,
            planVersionId: versionId,
            versionNo: 1,
            scenarioName: 'Base Forecast',
            anchorKind: 'cell',
            anchorKey: 'cell:4000:P01',
            accountCode: '4000',
            periodCode: 'P01',
            statementLineKey: null,
            authorId: userId,
            authorName: 'Owner',
            authorEmail: 'owner@onefpa.test',
            body: 'Check @rev@onefpa.test',
            mentionedUserIds: [userId],
            createdAt: '2026-11-25T12:00:00.000Z',
          },
        };
      }
      return {
        status: 200,
        body: {
          id: notifId,
          companyId,
          recipientId: userId,
          jobId: versionId,
          eventKind: 'mention',
          planVersionId: versionId,
          taskId: null,
          commentId,
          title: 'Mentioned on cell:4000:P01',
          body: 'Check @rev@onefpa.test',
          readAt: '2026-11-25T12:01:00.000Z',
          createdAt: '2026-11-25T12:00:00.000Z',
        },
      };
    });

    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    const overview = await client.getWorkflowOverview(companyId, { scenario: 'Base Forecast' });
    expect(overview.actorRole).toBe('owner');
    expect(calls[0]?.url).toBe(`/api/companies/${companyId}/workflow?scenario=Base+Forecast`);

    const member = await client.addCompanyMember(companyId, {
      email: 'rev@onefpa.test',
      displayName: 'Reviewer',
      role: 'reviewer',
    });
    expect(member.role).toBe('reviewer');
    expect(calls[1]?.url).toBe(`/api/companies/${companyId}/members`);

    const createdTask = await client.createApprovalTask(companyId, {
      planVersionId: versionId,
      title: 'Approve Q1',
    });
    expect(createdTask.status).toBe('draft');
    expect(calls[2]?.url).toBe(`/api/companies/${companyId}/workflow/approvals`);

    const submitted = await client.transitionApprovalTask(companyId, taskId, {
      targetStatus: 'submitted',
      expectedVersion: 1,
    });
    expect(submitted.status).toBe('submitted');
    expect(calls[3]?.url).toBe(`/api/companies/${companyId}/workflow/approvals/${taskId}/transition`);

    const comment = await client.createWorkflowComment(companyId, {
      planVersionId: versionId,
      anchor: { kind: 'cell', accountCode: '4000', periodCode: 'P01' },
      body: 'Check @rev@onefpa.test',
    });
    expect(comment.anchorKey).toBe('cell:4000:P01');
    expect(calls[4]?.url).toBe(`/api/companies/${companyId}/workflow/comments`);

    const readNotif = await client.markNotificationRead(companyId, notifId);
    expect(readNotif.readAt).toBe('2026-11-25T12:01:00.000Z');
    expect(calls[5]?.url).toBe(
      `/api/companies/${companyId}/workflow/notifications/${notifId}/read`,
    );
  });

  it('calls the Workforce workspace, save, preview, and commit routes with canonical string decimal payloads (WI-0035)', async () => {
    const companyId = String(COMPANY['companyId']);
    const posId = '44444444-4444-4444-8444-444444444444';
    const scenarioId = '55555555-5555-4555-8555-555555555555';
    const planVersionId = '66666666-6666-4666-8666-666666666666';

    const sampleWorkspace = {
      companyId,
      fiscalYear: 2026,
      currency: 'USD',
      currencyScale: 2,
      actorRole: 'owner',
      moduleSpec: {
        moduleKey: 'workforce',
        moduleName: 'Workforce & Headcount Compensation',
        version: '2.0.0',
        dimensions: ['department', 'position', 'account'],
        driverKinds: ['fixed'],
        recommendedStatementLineKeys: ['pl.opex.payroll'],
        inputColumns: [],
        reportPackSections: ['headcount_fte'],
      },
      periods: ['P01', 'P02'],
      accounts: [{ code: '5100', name: 'Direct Engineering Payroll', type: 'expense' }],
      positions: [
        {
          id: posId,
          positionCode: 'ENG-001',
          title: 'Senior Engineer',
          departmentName: 'Engineering',
          accountCode: '5100',
          accountName: 'Direct Engineering Payroll',
          startPeriodCode: 'P01',
          endPeriodCode: null,
          fte: '1.00',
          annualSalary: '120000.00',
          burdenRate: '0.20',
          bonusRate: '0.00',
          rampFirstPeriodPct: '1.00',
          meritPeriodCode: null,
          meritIncreasePct: '0.00',
          status: 'active',
          createdAt: '2026-11-25T12:00:00.000Z',
          updatedAt: '2026-11-25T12:00:00.000Z',
        },
      ],
    };

    const samplePreview = {
      companyId,
      fiscalYear: 2026,
      currency: 'USD',
      currencyScale: 2,
      periods: ['P01', 'P02'],
      positionPeriodRows: [],
      positionSummaries: [],
      departmentSummaries: [],
      fteByPeriod: { P01: '1.00', P02: '1.00' },
      costByPeriod: { P01: '12000.00', P02: '12000.00' },
      grandTotalFteMonths: '2.00',
      grandTotalCost: '24000.00',
      compiledDrivers: [],
      driverPlan: {
        fiscalYear: 2026,
        currencyScale: 2,
        periods: ['P01', 'P02'],
        lines: [],
        totalsByAccount: { '5100': '24000.00' },
        totalsByPeriod: { P01: '12000.00', P02: '12000.00' },
        grandTotal: '24000.00',
      },
    };

    const { fetchImpl, calls } = fakeFetch((req) => {
      if (req.url.includes('/workforce/commit')) {
        return {
          status: 201,
          body: {
            preview: samplePreview,
            commit: {
              scenarioId,
              scenarioName: 'Budget FY2026',
              scenarioKind: 'budget',
              planVersionId,
              versionNo: 1,
              lineCount: 2,
              grandTotal: '24000.00',
              totalsByAccount: { '5100': '24000.00' },
            },
          },
        };
      }
      if (req.url.includes('/workforce/preview')) {
        return { status: 200, body: samplePreview };
      }
      return { status: 200, body: sampleWorkspace };
    });

    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });

    const ws = await client.getWorkforceWorkspace(companyId, { year: 2026 });
    expect(ws.fiscalYear).toBe(2026);
    expect(calls[0]?.url).toBe(`/api/companies/${companyId}/workforce?year=2026`);

    const saved = await client.saveWorkforcePositions(companyId, {
      fiscalYear: 2026,
      positions: ws.positions.map(({ id: _id, accountName: _an, createdAt: _c, updatedAt: _u, ...p }) => p),
    });
    expect(saved.positions[0]?.annualSalary).toBe('120000.00');
    expect(calls[1]?.url).toBe(`/api/companies/${companyId}/workforce/positions`);

    const preview = await client.previewWorkforcePlan(companyId, { fiscalYear: 2026 });
    expect(preview.grandTotalCost).toBe('24000.00');
    expect(calls[2]?.url).toBe(`/api/companies/${companyId}/workforce/preview`);

    const committed = await client.commitWorkforcePlan(companyId, {
      fiscalYear: 2026,
      scenarioName: 'Budget FY2026',
      scenarioKind: 'budget',
      saveRoster: true,
    });
    expect(committed.commit.grandTotal).toBe('24000.00');
    expect(calls[3]?.url).toBe(`/api/companies/${companyId}/workforce/commit`);
  });

  it('calls M2 Flux Analysis and PVM Bridge endpoints with relative URLs and canonical decimal strings (WI-0036)', async () => {
    const companyId = String(COMPANY['companyId']);
    let step = 0;
    const { fetchImpl, calls } = fakeFetch(() => {
      step += 1;
      if (step === 1) {
        return {
          status: 200,
          body: {
            companyId,
            fiscalYear: 2026,
            throughPeriodCode: 'P01',
            scenarioId: null,
            scenarioName: 'Budget FY2026',
            planVersionId: null,
            versionNo: 1,
            hasPlan: true,
            minAbsVariance: '100.00',
            topN: 5,
            totalPlannedAccounts: 2,
            materialCount: 1,
            otherPlannedCount: 1,
            drivers: [
              {
                rank: 1,
                accountCode: '4000',
                accountName: 'Service revenue',
                accountType: 'revenue',
                actual: '11850.00',
                plan: '10000.00',
                varianceAmount: '1850.00',
                absVarianceAmount: '1850.00',
                variancePctKind: 'computed',
                variancePctFormatted: '18.50%',
                shareOfAbsVariancePct: '75.00%',
                favorability: 'favorable',
                isMaterial: true,
              },
            ],
            unplannedAccounts: [],
            bridge: {
              planTotal: '16000.00',
              topDriversVariance: '1850.00',
              otherPlannedVariance: '-100.00',
              plannedVarianceTotal: '1750.00',
              plannedActualTotal: '17750.00',
              unplannedActualTotal: '0.00',
              actualTotal: '17750.00',
              totalAbsPlannedVariance: '1950.00',
              revenueVariance: '1850.00',
              expenseVariance: '-100.00',
              netOperatingVariance: '1950.00',
              tieOutValid: true,
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          companyId,
          fiscalYear: 2026,
          periodCode: 'P01',
          baseCurrency: 'USD',
          scenarioName: null,
          totalPlanUnits: '200.00',
          totalActualUnits: '230.00',
          totalPlanRevenue: '3000.00',
          totalActualRevenue: '3410.00',
          totalVariance: '410.00',
          variancePct: '13.67%',
          variancePctStatus: 'computed',
          priceVariance: '10.00',
          volumeVariance: '450.00',
          mixVariance: '-50.00',
          invariantPassed: true,
          invariantDelta: '0',
          items: [
            {
              key: 'SKU_A',
              label: 'Enterprise Seat',
              planUnits: '100.00',
              planPrice: '10.00',
              actualUnits: '120.00',
              actualPrice: '11.00',
              planRevenue: '1000.00',
              actualRevenue: '1320.00',
              totalVariance: '320.00',
              priceEffect: '120.00',
              volumeAtPlanPrice: '200.00',
              mixContribution: '-25.00',
              favorability: 'favorable',
            },
          ],
        },
      };
    });

    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });
    const flux = await client.getFluxAnalysis(companyId, {
      period: 'P01',
      fiscalYear: 2026,
      minAbs: '100.00',
      topN: 5,
    });
    expect(calls[0]?.url).toBe(
      `/api/companies/${companyId}/variance/flux?period=P01&year=2026&minAbs=100.00&topN=5`,
    );
    expect(flux.bridge.tieOutValid).toBe(true);
    expect(flux.drivers[0]?.shareOfAbsVariancePct).toBe('75.00%');

    const pvm = await client.computePvmBridge(companyId, {
      periodCode: 'P01',
      fiscalYear: 2026,
      items: [
        {
          key: 'SKU_A',
          label: 'Enterprise Seat',
          planUnits: '100',
          planPrice: '10.00',
          actualUnits: '120',
          actualPrice: '11.00',
        },
      ],
    });
    expect(calls[1]?.url).toBe(`/api/companies/${companyId}/variance/pvm`);
    expect(calls[1]?.method).toBe('POST');
    expect(pvm.invariantPassed).toBe(true);
    expect(pvm.priceVariance).toBe('10.00');
    expect(pvm.mixVariance).toBe('-50.00');
  });

  it('fetches Dashboards v1 summary with period/year/template query params and preserves money strings', async () => {
    const companyId = String(COMPANY['companyId']);
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        companyId,
        companyName: 'Northwind Holdings Inc.',
        baseCurrency: 'USD',
        currencyScale: 2,
        range: { fromPeriodCode: 'P01', throughPeriodCode: 'P04', fiscalYear: 2026 },
        hasActuals: true,
        hasPlan: true,
        scenarioName: 'Budget FY2026',
        versionNo: 1,
        articulation: { valid: true, checks: [] },
        kpis: [
          {
            key: 'pnl.revenue',
            label: 'Revenue (YTD)',
            category: 'profitability',
            formula: 'SUM(pl.revenue.*)',
            sourceKeys: ['pl.revenue.product'],
            boardPackKey: 'statement:pnl.revenue',
            unit: 'currency',
            format: 'currency',
            basis: 'ytd',
            phase: 'M2',
            value: '1200.00',
            formattedValue: '1200.00',
            status: 'computed',
          },
        ],
        trend: [
          {
            periodCode: 'P01',
            periodNo: 1,
            fiscalYear: 2026,
            revenue: '300.00',
            ebitda: '90.00',
            netIncome: '63.00',
            operatingCashFlow: '75.00',
            endingCash: '500.00',
            revenueBarPct: 60,
            ebitdaBarPct: 18,
            cashBarPct: 100,
            ebitdaPositive: true,
            cashPositive: true,
          },
        ],
        reportBuilder: {
          templateId: 'cash_and_runway',
          templateLabel: 'Cash & Liquidity Brief',
          blockCount: 1,
          citedBlockCount: 1,
          unlinkedBlockCount: 0,
          citationCoveragePct: '100.00%',
          blocks: [
            {
              id: 'cash-end',
              kind: 'metric',
              title: 'Ending Cash Balance',
              citationKey: 'cf.ending_cash',
              unit: 'currency',
              value: '500.00',
              formattedValue: '500.00',
              status: 'computed',
              cited: true,
            },
          ],
        },
        sources: [],
      },
    }));

    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });
    const summary = await client.getDashboardSummary(companyId, {
      period: 'P04',
      fiscalYear: 2026,
      template: 'cash_and_runway',
    });

    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe(
      `/api/companies/${companyId}/dashboards?period=P04&year=2026&template=cash_and_runway`,
    );
    expect(calls[0]?.headers['authorization']).toBe('Bearer token-123');
    expect(typeof summary.kpis[0]?.value).toBe('string');
    expect(summary.kpis[0]?.formattedValue).toBe('1200.00');
    expect(summary.reportBuilder.citationCoveragePct).toBe('100.00%');
  });

  it('lists and applies M2 data-only industry packs via relative endpoints', async () => {
    const companyId = String(COMPANY['companyId']);
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.method === 'GET') {
        return {
          status: 200,
          body: {
            companyId,
            packs: [
              {
                key: 'saas',
                name: 'SaaS / Tech',
                version: '2.1.1',
                description: 'SaaS revenue and unit economics template.',
                defaultCalendar: '12month',
                defaultCurrencyHint: 'USD',
                localeHint: 'en-US',
                dataOnly: true,
                sha256ManifestHash: 'a'.repeat(64),
                accounts: [],
                drivers: [],
                kpis: [],
                layouts: [],
              },
            ],
          },
        };
      }
      return {
        status: 201,
        body: {
          companyId,
          packKey: 'saas',
          packVersion: '2.1.1',
          inserted: 7,
          updated: 0,
          accounts: [],
        },
      };
    });

    const client = createApiClient({ getToken: () => 'token-123', fetchImpl });
    const catalog = await client.listIndustryPacks(companyId);
    expect(calls[0]?.url).toBe(`/api/companies/${companyId}/packs`);
    expect(catalog.packs[0]?.dataOnly).toBe(true);

    const applied = await client.applyIndustryPack(companyId, 'saas');
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.url).toBe(`/api/companies/${companyId}/packs/saas/apply`);
    expect(applied.inserted).toBe(7);
  });
});
