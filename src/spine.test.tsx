import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SPINE_ROUTE_DEFS } from '../shared/spine.js';
import { App } from './App.js';
import BoardPackPage, { BoardPackPreview } from './pages/BoardPackPage.js';
import type {
  BoardPackReportPayload,
  ChartAccountPayload,
  ConnectorsOverviewResponse,
  IndustryPackDetail,
  OnboardingValidationReport,
} from './api/client.js';
import { ConnectorsPanel } from './components/ConnectorsPanel.js';
import { OnboardingPipelinePanel } from './components/OnboardingPipelinePanel.js';
import CoaMapperPage, { CoaMappingEditor, IndustryPackCatalogPanel } from './pages/CoaMapperPage.js';
import ImportWizardPage, { ImportWizardContent } from './pages/ImportWizardPage.js';
import ModelGridPage from './pages/ModelGridPage.js';
import SetupWizardPage from './pages/SetupWizardPage.js';
import SignInPage from './pages/SignInPage.js';
import StatementsPage from './pages/StatementsPage.js';

describe('7-Screen Spine Inventory, Landmarks & Five-State Honesty (U1–U3, §9.1–§9.6)', () => {
  it('enforces exact 7 spine routes and 7 page modules with zero cut-line screens (U1)', () => {
    expect(SPINE_ROUTE_DEFS.map((r) => r.path)).toEqual([
      '/sign-in',
      '/setup',
      '/import',
      '/coa-mapper',
      '/model-grid',
      '/statements',
      '/board-pack',
    ]);
    const pageFiles = readdirSync(join(process.cwd(), 'src/pages')).sort();
    expect(pageFiles).toEqual([
      'BoardPackPage.tsx',
      'CoaMapperPage.tsx',
      'ImportWizardPage.tsx',
      'ModelGridPage.tsx',
      'SetupWizardPage.tsx',
      'SignInPage.tsx',
      'StatementsPage.tsx',
    ]);
  });

  it('mounts exactly one skip link and all four WCAG AA landmarks across shell render', () => {
    const html = renderToStaticMarkup(createElement(App, { initialPath: '/sign-in' }));
    const skipMatches = html.match(/href="#main-content"/g) ?? [];
    expect(skipMatches.length).toBe(1);
    expect(html).toContain('role="banner"');
    expect(html).toContain('aria-label="Primary Spine Navigation"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('role="main"');
    expect(html).toContain('role="contentinfo"');
  });

  it('renders honest loading, empty, and error states across all 7 spine screens without invented data', () => {
    const pages = [
      SignInPage,
      SetupWizardPage,
      ImportWizardPage,
      CoaMapperPage,
      ModelGridPage,
      StatementsPage,
      BoardPackPage,
    ];
    const noop = (): void => {};

    for (const PageComponent of pages) {
      const loadingHtml = renderToStaticMarkup(
        createElement(PageComponent, { onNavigate: noop, forcedState: 'loading' }),
      );
      expect(loadingHtml).toContain('role="status"');
      expect(loadingHtml).toContain('aria-busy="true"');

      const emptyHtml = renderToStaticMarkup(
        createElement(PageComponent, { onNavigate: noop, forcedState: 'empty' }),
      );
      expect(emptyHtml).toContain('<h1');
      expect(emptyHtml).toContain('<button');
      expect(emptyHtml).not.toContain('—%');
      expect(emptyHtml).not.toContain('(0%)');

      const errorHtml = renderToStaticMarkup(
        createElement(PageComponent, { onNavigate: noop, forcedState: 'error' }),
      );
      expect(errorHtml).toContain('role="alert"');
      expect(errorHtml).toContain('Retry failed action');
    }
  });

  it('renders versioned mapping sources, targets and typed quarantine controls from server rows (WI-0028)', () => {
    const noop = (): void => {};
    const report = {
      companyId: '11111111-1111-4111-8111-111111111111',
      sourceSystem: 'csv' as const,
      effectiveFrom: '2026-11-25',
      mappings: [
        {
          sourceSystem: 'csv' as const,
          sourceCode: 'BANK-EXT',
          accountCode: '1000',
          accountName: 'Operating bank',
          mappingVersion: 2,
          effectiveFrom: '2026-11-25',
          status: 'mapped' as const,
          quarantineReason: null,
          targetConflict: false,
          rowCount: 3,
          sampleValues: ['Client receipt'],
        },
        {
          sourceSystem: 'csv' as const,
          sourceCode: 'HOLD-EXT',
          accountCode: null,
          accountName: null,
          mappingVersion: 1,
          effectiveFrom: '2026-11-25',
          status: 'quarantined' as const,
          quarantineReason: 'MANUAL_QUARANTINE' as const,
          targetConflict: false,
          rowCount: 2,
          sampleValues: ['Manual hold'],
        },
      ],
      availableAccounts: [{ code: '1000', name: 'Operating bank' }],
      mappedCount: 1,
      quarantinedCount: 1,
      unmappedCount: 0,
      conflictCount: 0,
    };
    const account: ChartAccountPayload = {
      code: '1000',
      name: 'Operating bank',
      type: 'asset',
      normalSide: 'debit',
      isContra: false,
      isPostable: true,
      statementLineKey: 'bs.asset.cash',
      parentCode: null,
      active: true,
      version: 1,
    };
    const html = renderToStaticMarkup(
      createElement(CoaMappingEditor, {
        report,
        accounts: [account],
        drafts: {
          'BANK-EXT': { status: 'mapped', accountCode: '1000', reason: null },
          'HOLD-EXT': { status: 'quarantined', accountCode: null, reason: 'MANUAL_QUARANTINE' },
        },
        notice: null,
        commitResult: null,
        onChange: noop,
        onAcceptAuto: noop,
        onQuarantineUnmapped: noop,
        onSave: noop,
        onReload: noop,
        onNavigate: noop,
      }),
    );

    expect(html).toContain('Source → account mapping');
    expect(html).toContain('BANK-EXT');
    expect(html).toContain('Client receipt');
    expect(html).toContain('2 (2026-11-25)');
    expect(html).toContain('MANUAL_QUARANTINE');
    expect(html).toContain('value="1000"');
    expect(html).toContain('Accept all auto (exact code matches)');
    expect(html).toContain('Quarantine unmapped');
    expect(html).toContain('Save mapping versions');
    expect(html).toContain('Reload mappings');
    expect(html).not.toContain('Go to Import Wizard');

    const emptyHtml = renderToStaticMarkup(
      createElement(CoaMappingEditor, {
        report: null,
        accounts: [],
        drafts: {},
        notice: null,
        commitResult: null,
        onChange: noop,
        onAcceptAuto: noop,
        onQuarantineUnmapped: noop,
        onSave: noop,
        onReload: noop,
        onNavigate: noop,
      }),
    );
    expect(emptyHtml).toContain('The mapping report could not be read.');
    expect(emptyHtml).toContain('Go to Import Wizard');
  });

  it('renders the populated board pack from server-issued rows only (U2/U5)', () => {
    const pack: BoardPackReportPayload = {
      companyId: '11111111-1111-4111-8111-111111111111',
      companyName: 'Preview Co',
      baseCurrency: 'USD',
      range: { fromPeriodCode: 'P01', throughPeriodCode: 'P02', fiscalYear: 2026 },
      rows: [
        {
          section: 'cover',
          key: 'statement:pnl.revenue',
          label: 'Revenue (YTD)',
          value: '987.65',
          detail: 'Year to date P01 to P02, FY2026',
        },
        {
          section: 'bva',
          key: 'bva:4000',
          label: '4000 - Service revenue',
          value: '750.25',
          detail: 'Plan not planned; variance not planned; not planned; na',
        },
      ],
      articulation: {
        valid: false,
        checks: [
          {
            id: 'A3',
            name: 'Balance sheet',
            passed: false,
            delta: '1.00',
            detail: 'assets != liabilities + equity',
          },
        ],
      },
      sources: [
        {
          batchId: '22222222-2222-4222-8222-222222222222',
          sourceFilename: 'preview.csv',
          sourceHash: 'b'.repeat(64),
          importedAt: '2026-11-25T00:00:00.000Z',
        },
      ],
      hasPlan: true,
      basis: 'Year to date P01 to P02, FY2026; plan basis: Budget FY2026 v1',
      disclosure: 'All figures are engine output.',
      bva: {
        companyId: '11111111-1111-4111-8111-111111111111',
        fiscalYear: 2026,
        throughPeriodCode: 'P02',
        scenarioId: null,
        scenarioName: 'Budget FY2026',
        planVersionId: null,
        versionNo: 1,
        hasPlan: true,
        rows: [
          {
            accountCode: '4000',
            accountName: 'Service revenue',
            accountType: 'revenue',
            actual: '750.25',
            plan: null,
            varianceAmount: null,
            variancePctKind: 'null',
            variancePctFormatted: null,
            favorability: 'na',
          },
        ],
        totals: {
          actual: '750.25',
          plan: '0.00',
          unplannedActual: '750.25',
          varianceAmount: '0.00',
          plannedRows: 0,
          unplannedRows: 1,
          favorable: 0,
          unfavorable: 0,
          neutral: 0,
          na: 1,
        },
        byType: [],
      },
    };

    const html = renderToStaticMarkup(
      createElement(BoardPackPreview, {
        pack,
        periods: [{ code: 'P02', label: 'P02 (Feb 2026)' }],
        period: 'P02',
        partial: true,
        onPeriodChange: () => {},
        onExport: () => {},
      }),
    );

    for (const row of pack.rows) {
      expect(html).toContain(row.label);
      expect(html).toContain(row.value);
      if (row.detail !== null) expect(html).toContain(row.detail);
    }
    expect(html).toContain('>Board Pack Export</h1>');
    expect(html).toContain('Export XLSX');
    expect(html).toContain('Export PDF');
    expect(html).toContain('Export PPTX');
    expect(html).toContain('Partial workspace data');
    expect(html).toContain('A3 fail 1.00');
    expect(html).not.toContain('—%');
  });

  it('renders M2 data-only industry packs inside CoaMapperPage without inventing metrics (WI-0039)', () => {
    const noop = (): void => {};
    const packs: readonly IndustryPackDetail[] = [
      {
        key: 'saas',
        name: 'SaaS / Tech',
        version: '2.1.1',
        description: 'SaaS revenue and unit economics baseline.',
        defaultCalendar: '12month',
        defaultCurrencyHint: 'USD',
        localeHint: 'en-US',
        dataOnly: true,
        sha256ManifestHash: 'a'.repeat(64),
        accounts: [
          {
            code: '4000',
            name: 'Subscription Revenue',
            packType: 'revenue',
            section: 'Revenue',
            type: 'revenue',
            normalSide: 'credit',
            statementLineKey: 'pl.revenue.product',
            isControl: true,
            isPostable: true,
          },
        ],
        drivers: [
          {
            key: 'arpu',
            name: 'ARPU',
            type: 'manual',
            unit: 'money',
            low: '0',
            high: '1000000000',
            defaultMethod: 'manual',
            links: ['revenue'],
          },
        ],
        kpis: [
          {
            key: 'nrr',
            name: 'Net Revenue Retention %',
            unit: 'nrr_pct',
            formula: '100 - churn * 100',
            targetValue: '115',
            targetDirection: 'gte',
            definition: 'Net Revenue Retention %',
            goodThreshold: '110',
            watchThreshold: '100',
          },
        ],
        layouts: [],
      },
    ];

    const populatedHtml = renderToStaticMarkup(
      createElement(IndustryPackCatalogPanel, {
        packs,
        selectedKey: 'saas',
        appliedResult: {
          companyId: '11111111-1111-4111-8111-111111111111',
          packKey: 'saas',
          packVersion: '2.1.1',
          inserted: 7,
          updated: 0,
          accounts: [],
        },
        onSelect: noop,
        onApply: noop,
      }),
    );

    expect(populatedHtml).toContain('Data-only industry pack templates (M2)');
    expect(populatedHtml).toContain('SaaS / Tech');
    expect(populatedHtml).toContain('DATA-ONLY');
    expect(populatedHtml).toContain('Apply SaaS / Tech chart');
    expect(populatedHtml).toContain('Applied saas v2.1.1: 7 created, 0 updated.');
    expect(populatedHtml).toContain('pl.revenue.product');
    expect(populatedHtml).toContain('Net Revenue Retention %');

    const emptyHtml = renderToStaticMarkup(
      createElement(IndustryPackCatalogPanel, {
        packs: [],
        selectedKey: null,
        appliedResult: null,
        onSelect: noop,
        onApply: noop,
      }),
    );
    expect(emptyHtml).toContain('No verified industry packs were loaded for this workspace.');
  });

  it('mounts Connectors radio option inside ImportWizardPage (1 h1) and renders all ConnectorsPanel states honestly (WI-0040)', () => {
    const noop = (): void => {};
    const companyId = '11111111-1111-4111-8111-111111111111';

    const wizardHtml = renderToStaticMarkup(
      createElement(ImportWizardContent, {
        company: {
          id: companyId,
          name: 'Wire Co',
          currency: 'USD',
          calendarKind: '12month',
          fiscalYear: 2026,
          calendarYears: [],
          periodCount: 12,
        },
        authToken: 'token-123',
        onNavigate: noop,
      }),
    );
    expect(wizardHtml.match(/<h1\b/g)?.length).toBe(1);
    expect(wizardHtml).toContain('Actuals — GL journal CSV');
    expect(wizardHtml).toContain('Budget — account × period plan CSV');
    expect(wizardHtml).toContain('Connectors — Google Sheets, QBO &amp; Xero sync');

    const loadingHtml = renderToStaticMarkup(
      createElement(ConnectorsPanel, {
        companyId,
        authToken: 'token-123',
        onNavigate: noop,
        initialState: 'loading',
      }),
    );
    expect(loadingHtml).toContain('role="status"');
    expect(loadingHtml).toContain('Loading connectors and sync ledger...');

    const emptyHtml = renderToStaticMarkup(
      createElement(ConnectorsPanel, {
        companyId,
        authToken: 'token-123',
        onNavigate: noop,
        initialState: 'empty',
        initialOverview: { companyId, baseCurrency: 'USD', connectors: [], recentRuns: [] },
      }),
    );
    expect(emptyHtml).toContain('No external connectors are configured for this company yet.');
    expect(emptyHtml).toContain('Reload Connectors');

    const errorHtml = renderToStaticMarkup(
      createElement(ConnectorsPanel, {
        companyId,
        authToken: 'token-123',
        onNavigate: noop,
        initialState: 'error',
        initialFailure: {
          code: 'TENANT_FORBIDDEN',
          message: 'Only workspace owners or editors may configure or run external connectors.',
          action: 'load',
        },
      }),
    );
    expect(errorHtml).toContain('TENANT_FORBIDDEN');
    expect(errorHtml).toContain('Retry failed action');

    const overviewWithQuarantine: ConnectorsOverviewResponse = {
      companyId,
      baseCurrency: 'USD',
      connectors: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          companyId,
          sourceSystem: 'quickbooks_online',
          name: 'QBO Sandbox Primary',
          externalRef: 'realm-913035',
          syncCursor: '2026-04-30',
          status: 'active',
          lastSyncedAt: '2026-11-26T00:00:00.000Z',
          createdAt: '2026-11-26T00:00:00.000Z',
          updatedAt: '2026-11-26T00:00:00.000Z',
        },
      ],
      recentRuns: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          companyId,
          connectorId: '22222222-2222-4222-8222-222222222222',
          sourceSystem: 'quickbooks_online',
          connectorName: 'QBO Sandbox Primary',
          mode: 'incremental',
          status: 'quarantined',
          cursorBefore: '2026-04-01',
          cursorAfter: '2026-04-01',
          sourceHash: 'a'.repeat(64),
          rowsPulled: 2,
          rowsImported: 0,
          rowsQuarantined: 2,
          totalDebits: '500.00',
          totalCredits: '450.00',
          reconciliationStatus: 'mismatch_quarantined',
          reconciliationReason: 'RECONCILIATION_IMBALANCE:ref=QBO-BAD:debit=500.00:credit=450.00',
          importBatchId: null,
          replacedRunId: null,
          startedAt: '2026-11-26T00:05:00.000Z',
          completedAt: '2026-11-26T00:05:01.000Z',
        },
      ],
    };
    const partialHtml = renderToStaticMarkup(
      createElement(ConnectorsPanel, {
        companyId,
        authToken: 'token-123',
        onNavigate: noop,
        initialState: 'populated',
        initialOverview: overviewWithQuarantine,
      }),
    );
    expect(partialHtml).toContain('Partial workspace data');
    expect(partialHtml).toContain('QBO Sandbox Primary (QuickBooks Online)');
    expect(partialHtml).toContain('mismatch_quarantined: RECONCILIATION_IMBALANCE');
    expect(partialHtml).toContain('500.00');
    expect(partialHtml).toContain('450.00');
    expect(partialHtml).not.toContain('<h1>');
    expect(partialHtml).not.toContain('rounded-full');
  });

  it('mounts Onboarding radio option inside ImportWizardPage (1 h1) and renders all OnboardingPipelinePanel states honestly (WI-0042)', () => {
    const noop = (): void => {};
    const companyId = '11111111-1111-4111-8111-111111111111';

    const wizardHtml = renderToStaticMarkup(
      createElement(ImportWizardContent, {
        company: {
          id: companyId,
          name: 'Wire Co',
          currency: 'USD',
          calendarKind: '12month',
          fiscalYear: 2026,
          calendarYears: [],
          periodCount: 12,
        },
        authToken: 'token-123',
        onNavigate: noop,
      }),
    );
    expect(wizardHtml.match(/<h1\b/g)?.length).toBe(1);
    expect(wizardHtml).toContain('Onboarding — CoA match, validation &amp; cutover rehearsal');

    const loadingHtml = renderToStaticMarkup(
      createElement(OnboardingPipelinePanel, {
        companyId,
        authToken: 'token-123',
        onNavigate: noop,
        initialState: 'loading',
      }),
    );
    expect(loadingHtml).toContain('role="status"');
    expect(loadingHtml).toContain('Running deterministic CoA matching');

    const emptyHtml = renderToStaticMarkup(
      createElement(OnboardingPipelinePanel, {
        companyId,
        authToken: 'token-123',
        onNavigate: noop,
        initialState: 'empty',
      }),
    );
    expect(emptyHtml).toContain('No partner migration payload has been validated yet.');
    expect(emptyHtml).toContain('Validate Partner Export');

    const errorHtml = renderToStaticMarkup(
      createElement(OnboardingPipelinePanel, {
        companyId,
        authToken: 'token-123',
        onNavigate: noop,
        initialState: 'error',
        initialFailure: {
          code: 'TENANT_FORBIDDEN',
          message: 'Only workspace owners or editors may run customer onboarding.',
          action: 'validate',
        },
      }),
    );
    expect(errorHtml).toContain('TENANT_FORBIDDEN');
    expect(errorHtml).toContain('Retry failed action');

    const validationReport: OnboardingValidationReport = {
      companyId,
      sourceHash: 'd'.repeat(64),
      asOfDate: '2026-11-26',
      rowsIn: 10,
      importableCount: 8,
      quarantinedCount: 2,
      rowAccountingTies: true,
      duplicatesDetected: 0,
      entryCount: 4,
      totalDebits: '58000.00',
      totalCredits: '58000.00',
      coveredPeriods: ['FY2026 P01', 'FY2026 P02', 'FY2026 P04'],
      missingInteriorPeriods: ['FY2026 P03'],
      leadingZeroCollisions: [],
      quarantineBreakdown: [{ category: 'BLANK_ROW', count: 1 }],
      quarantined: [{ rowNo: 10, reason: 'BLANK_ROW' }],
      anomalies: [
        {
          kind: 'calendar_gap',
          severity: 'review',
          title: 'Potential exception — review calendar gap',
          detail: 'Potential exception — review: Missing interior fiscal period(s): FY2026 P03.',
        },
      ],
      suggestions: [
        {
          sourceCode: 'OPS-CASH',
          rowCount: 3,
          sampleValues: ['Collection'],
          currentStatus: 'unmapped',
          currentAccountCode: null,
          suggestedAccountCode: '1000',
          suggestedAccountName: 'Operating Cash',
          matchRule: 'token_name_match',
          confidenceScore: 74,
          reason: 'Deterministic keyword match',
          requiresHumanApproval: true,
        },
      ],
      availableAccounts: [{ code: '1000', name: 'Operating Cash' }],
      goLiveStatus: 'ready_with_warnings',
      blockers: [],
      warnings: ['Potential exception — review: Missing interior fiscal period(s): FY2026 P03.'],
    };

    const populatedHtml = renderToStaticMarkup(
      createElement(OnboardingPipelinePanel, {
        companyId,
        authToken: 'token-123',
        onNavigate: noop,
        initialState: 'populated',
        initialValidation: validationReport,
        initialRehearsals: [
          {
            companyId,
            mode: 'dry_run',
            rehearsalHash: 'a'.repeat(64),
            sourceHash: 'd'.repeat(64),
            validation: validationReport,
            committed: null,
            trialBalanceAfter: {
              isBalanced: true,
              totalDebit: '58000.00',
              totalCredit: '58000.00',
              accountCount: 4,
            },
            executedAt: '2026-11-26T05:30:00.000Z',
          },
        ],
      }),
    );
    expect(populatedHtml).toContain('Partial workspace data');
    expect(populatedHtml).toContain('Row accounting ties');
    expect(populatedHtml).toContain('FY2026 P03');
    expect(populatedHtml).toContain('Approve Selected CoA Mappings');
    expect(populatedHtml).toContain('Cutover rehearsal ledger (1 run(s))');
    expect(populatedHtml).toContain('58000.00');
    expect(populatedHtml).not.toContain('<h1>');
    expect(populatedHtml).not.toContain('rounded-full');
  });
});

