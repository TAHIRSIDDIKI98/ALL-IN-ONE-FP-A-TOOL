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
  getStatements(
    companyId: string,
    query: { readonly period: string; readonly fiscalYear?: number | null },
  ): Promise<FinancialStatementsPayload>;
  previewImport(companyId: string, request: ImportPreviewRequest): Promise<ImportPreviewPayload>;
  getChart(companyId: string): Promise<ChartOfAccountsPayload>;
  importChart(companyId: string, request: { readonly csvText: string }): Promise<ChartImportPayload>;
  getBudget(
    companyId: string,
    query: { readonly fiscalYear: number },
  ): Promise<BudgetReportPayload>;
  getBva(
    companyId: string,
    query: { readonly period: string; readonly fiscalYear?: number | null },
  ): Promise<BvaReportPayload>;
  importBudget(
    companyId: string,
    request: {
      readonly csvText: string;
      readonly fiscalYear: number;
      readonly sourceFilename?: string;
    },
  ): Promise<BudgetImportPayload>;
  commitImport(companyId: string, request: ImportCommitRequest): Promise<ImportCommitPayload>;
  getTrialBalance(
    companyId: string,
    query?: { readonly period?: string | null },
  ): Promise<TrialBalancePayload>;
  getAccountDrilldown(
    companyId: string,
    accountCode: string,
    query?: { readonly period?: string | null },
  ): Promise<AccountDrilldownPayload>;
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
    getStatements: (companyId, query) => {
      const params = new URLSearchParams({ period: query.period });
      if (query.fiscalYear !== undefined && query.fiscalYear !== null) {
        params.set('year', String(query.fiscalYear));
      }
      return request<FinancialStatementsPayload>(
        'GET',
        `/api/companies/${encodeURIComponent(companyId)}/statements?${params.toString()}`,
      );
    },
    /**
     * Company-scoped read-only preview. The SERVER classifies the rows against its own chart and
     * applies the journal-balance gate, so the browser never supplies — or invents — the set of
     * mapped accounts and the preview can never disagree with the commit (§1.6-7, G1).
     */
    previewImport: (companyId, previewRequest) =>
      request<ImportPreviewPayload>(
        'POST',
        `/api/companies/${encodeURIComponent(companyId)}/import/preview`,
        { csvText: previewRequest.csvText },
      ),
    getChart: (companyId) =>
      request<ChartOfAccountsPayload>(
        'GET',
        `/api/companies/${encodeURIComponent(companyId)}/accounts`,
      ),
    importChart: (companyId, chartRequest) =>
      request<ChartImportPayload>(
        'POST',
        `/api/companies/${encodeURIComponent(companyId)}/chart/import`,
        { csvText: chartRequest.csvText },
      ),
    getBudget: (companyId, query) => {
      const params = new URLSearchParams();
      params.set('year', String(query.fiscalYear));
      return request<BudgetReportPayload>(
        'GET',
        `/api/companies/${encodeURIComponent(companyId)}/budget?${params.toString()}`,
      );
    },
    getBva: (companyId, query) => {
      const params = new URLSearchParams();
      params.set('period', query.period);
      if (query.fiscalYear !== undefined && query.fiscalYear !== null) {
        params.set('year', String(query.fiscalYear));
      }
      return request<BvaReportPayload>(
        'GET',
        `/api/companies/${encodeURIComponent(companyId)}/bva?${params.toString()}`,
      );
    },
    importBudget: (companyId, budgetRequest) =>
      request<BudgetImportPayload>(
        'POST',
        `/api/companies/${encodeURIComponent(companyId)}/budget/import`,
        {
          csvText: budgetRequest.csvText,
          fiscalYear: budgetRequest.fiscalYear,
          ...(budgetRequest.sourceFilename === undefined
            ? {}
            : { sourceFilename: budgetRequest.sourceFilename }),
        },
      ),
    commitImport: (companyId, commitRequest) =>
      request<ImportCommitPayload>(
        'POST',
        `/api/companies/${encodeURIComponent(companyId)}/import/commit`,
        { kind: commitRequest.kind, sourceFilename: commitRequest.sourceFilename, csvText: commitRequest.csvText },
      ),
    getTrialBalance: (companyId, query) => {
      const params = new URLSearchParams();
      if (query?.period !== undefined && query.period !== null) params.set('period', query.period);
      const suffix = params.toString();
      return request<TrialBalancePayload>(
        'GET',
        `/api/companies/${encodeURIComponent(companyId)}/trial-balance${suffix.length > 0 ? `?${suffix}` : ''}`,
      );
    },
    getAccountDrilldown: (companyId, accountCode, query) => {
      const params = new URLSearchParams();
      if (query?.period !== undefined && query.period !== null) params.set('period', query.period);
      const suffix = params.toString();
      return request<AccountDrilldownPayload>(
        'GET',
        `/api/companies/${encodeURIComponent(companyId)}/accounts/${encodeURIComponent(accountCode)}/drill${
          suffix.length > 0 ? `?${suffix}` : ''
        }`,
      );
    },
  };
}

export interface FinancialStatementsPayload {
  readonly companyId: string;
  readonly range: { readonly fromPeriodCode: string; readonly throughPeriodCode: string; readonly fiscalYear: number };
  readonly pnl: Readonly<Record<string, string>> & {
    readonly revenue: string;
    readonly cogs: string;
    readonly grossProfit: string;
    readonly opex: string;
    readonly ebitda: string;
    readonly depreciation: string;
    readonly ebit: string;
    readonly nonOperatingNet: string;
    readonly ebt: string;
    readonly tax: string;
    readonly netIncome: string;
  };
  readonly balanceSheet: Readonly<Record<string, string>> & {
    readonly totalAssets: string;
    readonly totalLiabilities: string;
    readonly totalEquity: string;
    readonly totalLiabilitiesAndEquity: string;
    readonly cashBalance: string;
    readonly isBalanced: boolean;
  };
  readonly cashFlow: Readonly<Record<string, string>> & {
    readonly netIncome: string;
    readonly nonCashAddbacks: string;
    readonly deltaWorkingCapitalCashImpact: string;
    readonly operatingCashFlow: string;
    readonly investingCashFlow: string;
    readonly freeCashFlow: string;
    readonly financingCashFlow: string;
    readonly beginningCash: string;
    readonly endingCash: string;
  };
  readonly retainedEarnings: {
    readonly opening: string;
    readonly netIncome: string;
    readonly distributions: string;
    readonly closingTotal: string;
    readonly rollForwardValid: boolean;
  };
  readonly articulation: {
    readonly valid: boolean;
    readonly checks: readonly { readonly id: string; readonly name: string; readonly passed: boolean; readonly detail: string }[];
  };
  readonly sources: readonly { readonly sourceFilename: string; readonly sourceHash: string }[];
}

/**
 * Import preview/commit contracts (shared/import.ts + server/app.ts `/api/import/preview`).
 * Money stays a canonical decimal string end to end (§5.2 E11).
 */
export interface ImportPreviewRequest {
  readonly csvText: string;
}

export interface ImportPreviewRow {
  readonly rowNo: number;
  readonly entryRef: string;
  readonly postingDate: string;
  readonly accountCode: string;
  readonly description: string;
  readonly debit: string;
  readonly credit: string;
}

export interface QuarantineReason {
  readonly rowNo: number;
  readonly reason: string;
}

export interface ImportPreviewPayload {
  readonly companyId: string;
  readonly rowsIn: number;
  readonly importedCount: number;
  readonly quarantinedCount: number;
  readonly duplicatesDetected: number;
  readonly entryCount: number;
  readonly totalDebits: string;
  readonly totalCredits: string;
  readonly imported: readonly ImportPreviewRow[];
  readonly quarantined: readonly QuarantineReason[];
}

export interface ImportCommitRequest {
  readonly kind: 'actuals' | 'budget';
  readonly sourceFilename: string;
  readonly csvText: string;
}

export interface ImportCommitPayload {
  readonly batchId: string;
  readonly replacedBatchId: string | null;
  readonly rowsIn: number;
  readonly importedCount: number;
  readonly quarantinedCount: number;
  readonly duplicatesDetected: number;
  readonly totalDebits: string;
  readonly totalCredits: string;
  readonly entryCount: number;
  readonly sourceHash: string;
  readonly quarantined: readonly QuarantineReason[];
}

/** Trial-balance read model (shared/reports.ts `TrialBalanceReportSchema`). */
export interface TrialBalanceRowPayload {
  readonly accountId: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly normalSide: string;
  readonly statementLineKey: string;
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly naturalActivity: string;
  readonly sheetContribution: string;
}

export interface TrialBalanceSourcePayload {
  readonly batchId: string;
  readonly sourceFilename: string;
  readonly sourceHash: string;
  readonly importedAt: string;
}

export interface TrialBalancePayload {
  readonly companyId: string;
  readonly throughPeriodCode: string | null;
  readonly rows: readonly TrialBalanceRowPayload[];
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly isBalanced: boolean;
  readonly unbalancedEntryIds: readonly string[];
  readonly sources: readonly TrialBalanceSourcePayload[];
}

/** Drill-to-source read model (shared/reports.ts `AccountDrilldownSchema`). */
export interface AccountDrillRowPayload {
  readonly entryId: string;
  readonly entryDate: string;
  readonly sourceRef: string | null;
  readonly periodCode: string;
  readonly debit: string;
  readonly credit: string;
  readonly batchId: string;
  readonly sourceFilename: string;
  readonly sourceHash: string;
  readonly rowNo: number;
  readonly rawCells: readonly string[];
}

export interface AccountDrilldownPayload {
  readonly companyId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly throughPeriodCode: string | null;
  readonly rows: readonly AccountDrillRowPayload[];
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly naturalActivity: string;
}

/** Chart-of-accounts contracts (shared/chart.ts) — the target side of every import mapping. */
export interface ChartAccountPayload {
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly normalSide: string;
  readonly isContra: boolean;
  readonly isPostable: boolean;
  readonly statementLineKey: string;
  readonly parentCode: string | null;
  readonly active: boolean;
  readonly version: number;
}

export interface ChartOfAccountsPayload {
  readonly companyId: string;
  readonly accounts: readonly ChartAccountPayload[];
}

export interface ChartImportPayload {
  readonly companyId: string;
  readonly rowCount: number;
  readonly inserted: number;
  readonly updated: number;
  readonly accounts: readonly ChartAccountPayload[];
}

/** Budget (plan) contracts (shared/budget.ts) — plan rows never reach the GL. */
export interface BudgetLinePayload {
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: string;
  readonly periodCode: string;
  readonly periodNo: number;
  readonly amount: string;
}

export interface BudgetAccountTotalPayload {
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: string;
  readonly normalSide: string;
  readonly amount: string;
}

export interface BudgetReportPayload {
  readonly companyId: string;
  readonly fiscalYear: number;
  readonly scenarioId: string | null;
  readonly scenarioName: string | null;
  readonly planVersionId: string | null;
  readonly versionNo: number | null;
  readonly lineCount: number;
  readonly totalAmount: string;
  readonly lines: readonly BudgetLinePayload[];
  readonly accounts: readonly BudgetAccountTotalPayload[];
}

export interface BudgetImportPayload extends BudgetReportPayload {
  readonly rowCount: number;
}

/** Budget-vs-Actual contracts (shared/bva.ts) — plan null means "not planned", never zero. */
export interface BvaRowPayload {
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: string;
  readonly actual: string | null;
  readonly plan: string | null;
  readonly varianceAmount: string | null;
  readonly variancePctKind: 'computed' | 'zero' | 'nm' | 'null';
  readonly variancePctFormatted: string | null;
  readonly favorability: 'favorable' | 'unfavorable' | 'neutral' | 'na';
}

export interface BvaReportPayload {
  readonly companyId: string;
  readonly fiscalYear: number;
  readonly throughPeriodCode: string;
  readonly scenarioId: string | null;
  readonly scenarioName: string | null;
  readonly planVersionId: string | null;
  readonly versionNo: number | null;
  readonly hasPlan: boolean;
  readonly rows: readonly BvaRowPayload[];
  readonly totals: {
    readonly actual: string;
    readonly plan: string;
    readonly unplannedActual: string;
    readonly varianceAmount: string;
    readonly plannedRows: number;
    readonly unplannedRows: number;
    readonly favorable: number;
    readonly unfavorable: number;
    readonly neutral: number;
    readonly na: number;
  };
  readonly byType: readonly {
    readonly accountType: string;
    readonly actual: string;
    readonly plan: string;
    readonly varianceAmount: string;
  }[];
}
