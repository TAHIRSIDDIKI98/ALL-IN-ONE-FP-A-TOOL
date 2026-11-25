import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SPINE_ROUTE_DEFS } from '../shared/spine.js';
import { App } from './App.js';
import BoardPackPage, { BoardPackPreview } from './pages/BoardPackPage.js';
import type { BoardPackReportPayload } from './api/client.js';
import CoaMapperPage from './pages/CoaMapperPage.js';
import ImportWizardPage from './pages/ImportWizardPage.js';
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
    expect(html).toContain('Partial workspace data');
    expect(html).toContain('A3 fail 1.00');
    expect(html).not.toContain('—%');
  });

});
