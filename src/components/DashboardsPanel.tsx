import { useState, type ReactElement } from 'react';
import type {
  DashboardReportTemplateId,
  DashboardSummaryResponse,
  EvaluatedKpiDto,
  MetricCategoryDto,
} from '../../shared/dashboards.js';
import {
  InlineEmptyState,
  InlineErrorState,
  LoadingState,
  PartialBanner,
} from './StateFrame.js';

type CategoryFilter = 'all' | MetricCategoryDto;

const CATEGORY_OPTIONS: readonly { readonly id: CategoryFilter; readonly label: string }[] = [
  { id: 'all', label: 'All KPIs' },
  { id: 'profitability', label: 'Profitability' },
  { id: 'cash', label: 'Cash & Liquidity' },
  { id: 'balance_sheet', label: 'Balance Sheet' },
  { id: 'plan', label: 'Plan & Variance' },
];

const TEMPLATE_OPTIONS: readonly { readonly id: DashboardReportTemplateId; readonly label: string }[] = [
  { id: 'executive_summary', label: 'Executive Summary Pack' },
  { id: 'cash_and_runway', label: 'Cash & Liquidity Brief' },
  { id: 'plan_performance', label: 'Plan & Operating Leverage Review' },
];

const HEADLINE_KEYS: readonly string[] = [
  'pnl.revenue',
  'pnl.ebitda',
  'pnl.net_income',
  'cf.ending_cash',
];

function formatCategoryLabel(category: MetricCategoryDto): string {
  switch (category) {
    case 'profitability':
      return 'Profitability';
    case 'cash':
      return 'Cash';
    case 'balance_sheet':
      return 'Balance Sheet';
    case 'plan':
      return 'Plan';
  }
}

function renderKpiValue(kpi: EvaluatedKpiDto): ReactElement {
  if (kpi.status === 'not_planned') {
    return <span className="font-mono text-slate-500">{kpi.formattedValue}</span>;
  }
  if (kpi.status === 'nm') {
    return <span className="font-mono text-slate-500">{kpi.formattedValue}</span>;
  }
  return <span className="font-mono font-semibold text-slate-900 tabular-nums">{kpi.formattedValue}</span>;
}

export function DashboardsPanel(props: {
  readonly dashboard: DashboardSummaryResponse | null;
  readonly loadState: 'idle' | 'loading' | 'error';
  readonly loadError: { readonly code: string; readonly message: string } | null;
  readonly templateId: DashboardReportTemplateId;
  readonly onChangeTemplate: (next: DashboardReportTemplateId) => void;
  readonly onRetry: () => void;
  readonly onOpenImport: () => void;
}): ReactElement {
  const { dashboard, loadState, loadError, templateId } = props;
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  if (loadState === 'loading') {
    return <LoadingState label="Evaluating KPI catalog, period trend, and Report Builder from committed ledger postings..." />;
  }

  if (loadState === 'error') {
    return (
      <InlineErrorState
        code={loadError?.code ?? 'INTERNAL_ERROR'}
        message={loadError?.message ?? 'Unable to load Dashboards v1 summary.'}
        onRetry={props.onRetry}
      />
    );
  }

  if (dashboard === null || !dashboard.hasActuals) {
    return (
      <InlineEmptyState
        disclosure="No committed GL ledger postings exist for this period range yet, so Dashboards v1 has no actual activity to evaluate."
        ctaLabel="Open Import Wizard"
        onAction={props.onOpenImport}
      />
    );
  }

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredKpis = dashboard.kpis.filter((kpi) => {
    if (categoryFilter !== 'all' && kpi.category !== categoryFilter) {
      return false;
    }
    if (normalizedQuery.length === 0) {
      return true;
    }
    return (
      kpi.key.toLowerCase().includes(normalizedQuery) ||
      kpi.label.toLowerCase().includes(normalizedQuery) ||
      kpi.formula.toLowerCase().includes(normalizedQuery)
    );
  });

  const headlineKpis = HEADLINE_KEYS.map((key) => dashboard.kpis.find((item) => item.key === key)).filter(
    (item): item is EvaluatedKpiDto => item !== undefined,
  );

  const planSummary =
    dashboard.hasPlan && dashboard.scenarioName !== null
      ? `${dashboard.scenarioName} v${String(dashboard.versionNo ?? 1)}`
      : 'no committed budget plan';

  const chartColumnWidth = 64;
  const chartPlotHeight = 112;
  const chartSvgWidth = Math.max(dashboard.trend.length * chartColumnWidth + 24, 320);

  return (
    <div id="dashboards-panel" className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Executive KPIs &amp; Report Builder</h2>
          <p className="mt-0.5 text-xs text-slate-600">
            {dashboard.range.fromPeriodCode}–{dashboard.range.throughPeriodCode} of FY
            {String(dashboard.range.fiscalYear)} · {dashboard.baseCurrency} · plan basis: {planSummary}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="font-mono tabular-nums">{String(dashboard.kpis.length)} KPI definitions</span>
          <span>·</span>
          <span className="font-mono tabular-nums">
            {dashboard.reportBuilder.citationCoveragePct} cited
          </span>
        </div>
      </div>

      {!dashboard.hasPlan && (
        <PartialBanner detail="No current budget plan version is committed for this fiscal year; plan attainment KPIs show 'not planned' instead of an inferred zero target." />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {headlineKpis.map((kpi) => (
          <div
            key={kpi.key}
            className="rounded border border-slate-200 bg-white px-4 py-3"
          >
            <p className="text-xs font-medium text-slate-600">{kpi.label}</p>
            <p className="mt-1 text-xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
              {kpi.formattedValue}
            </p>
            <p className="mt-1 text-[11px] font-mono text-slate-500">
              {kpi.key} · {kpi.basis}
            </p>
          </div>
        ))}
      </div>

      <section aria-labelledby="trend-heading" className="rounded border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="trend-heading" className="text-sm font-semibold text-slate-900">
              Period Performance Trend ({dashboard.range.fromPeriodCode}–{dashboard.range.throughPeriodCode})
            </h3>
            <p className="text-xs text-slate-600">
              Single-period Revenue &amp; EBITDA with cumulative Ending Cash computed strictly from active GL batches.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 bg-slate-900" aria-hidden="true" />
              Revenue
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 bg-emerald-600" aria-hidden="true" />
              EBITDA
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 bg-sky-600" aria-hidden="true" />
              Ending Cash
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <svg
            width={chartSvgWidth}
            height={148}
            viewBox={`0 0 ${String(chartSvgWidth)} 148`}
            role="img"
            aria-label={`Period financial trend chart from ${dashboard.range.fromPeriodCode} through ${dashboard.range.throughPeriodCode}`}
            className="block"
          >
            <title>
              {`Period financial trend from ${dashboard.range.fromPeriodCode} through ${dashboard.range.throughPeriodCode}`}
            </title>
            <line x1={8} y1={120} x2={chartSvgWidth - 8} y2={120} stroke="#CBD5E1" strokeWidth={1} />
            {dashboard.trend.map((point, index) => {
              const groupX = index * chartColumnWidth + 16;
              const revHeight = Math.round((point.revenueBarPct * chartPlotHeight) / 100);
              const ebitdaHeight = Math.round((point.ebitdaBarPct * chartPlotHeight) / 100);
              const cashHeight = Math.round((point.cashBarPct * chartPlotHeight) / 100);
              return (
                <g key={point.periodCode}>
                  <rect
                    x={groupX}
                    y={120 - revHeight}
                    width={12}
                    height={revHeight}
                    fill="#0F172A"
                  />
                  <rect
                    x={groupX + 15}
                    y={120 - ebitdaHeight}
                    width={12}
                    height={ebitdaHeight}
                    fill={point.ebitdaPositive ? '#059669' : '#DC2626'}
                  />
                  <rect
                    x={groupX + 30}
                    y={120 - cashHeight}
                    width={12}
                    height={cashHeight}
                    fill={point.cashPositive ? '#0284C7' : '#DC2626'}
                  />
                  <text
                    x={groupX + 21}
                    y={138}
                    textAnchor="middle"
                    fill="#475569"
                    fontSize={11}
                    fontFamily="monospace"
                  >
                    {point.periodCode}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <caption className="sr-only">
              Monthly Revenue, EBITDA, Net Income, Operating Cash Flow, and Ending Cash
            </caption>
            <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">Period</th>
                <th scope="col" className="px-3 py-2 text-right">Revenue</th>
                <th scope="col" className="px-3 py-2 text-right">EBITDA</th>
                <th scope="col" className="px-3 py-2 text-right">Net Income</th>
                <th scope="col" className="px-3 py-2 text-right">Operating CF</th>
                <th scope="col" className="px-3 py-2 text-right">Ending Cash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {dashboard.trend.map((pt) => (
                <tr key={pt.periodCode}>
                  <th scope="row" className="px-3 py-2 text-left font-mono font-medium text-slate-900">
                    {pt.periodCode}
                  </th>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                    {pt.revenue}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                    {pt.ebitda}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                    {pt.netIncome}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                    {pt.operatingCashFlow}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                    {pt.endingCash}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="kpi-library-heading" className="rounded border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="kpi-library-heading" className="text-sm font-semibold text-slate-900">
              Canonical KPI Library
            </h3>
            <p className="text-xs text-slate-600">
              Every definition originates once in the financial kernel with explicit formula, unit, and statement sources.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="kpi-search" className="block text-xs font-medium text-slate-600">
                Search KPIs
              </label>
              <input
                id="kpi-search"
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Key, label, or formula..."
                className="mt-1 w-56 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>
        </div>

        <div role="group" aria-label="KPI Categories" className="flex flex-wrap gap-1.5">
          {CATEGORY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={categoryFilter === opt.id}
              onClick={() => setCategoryFilter(opt.id)}
              className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                categoryFilter === opt.id
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <caption className="sr-only">Evaluated KPI Library</caption>
            <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">Metric</th>
                <th scope="col" className="px-3 py-2">Category</th>
                <th scope="col" className="px-3 py-2">Formula</th>
                <th scope="col" className="px-3 py-2">Basis</th>
                <th scope="col" className="px-3 py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredKpis.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                    No KPIs match the active category and keyword filters.
                  </td>
                </tr>
              ) : (
                filteredKpis.map((kpi) => (
                  <tr key={kpi.key}>
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <div className="font-medium text-slate-900">{kpi.label}</div>
                      <div className="font-mono text-[11px] text-slate-500">{kpi.key}</div>
                    </th>
                    <td className="px-3 py-2 text-slate-700">{formatCategoryLabel(kpi.category)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{kpi.formula}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{kpi.basis}</td>
                    <td className="px-3 py-2 text-right">{renderKpiValue(kpi)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="report-builder-heading" className="rounded border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="report-builder-heading" className="text-sm font-semibold text-slate-900">
              Report Builder ({dashboard.reportBuilder.templateLabel})
            </h3>
            <p className="text-xs text-slate-600">
              Composes canonical metric and statement-line blocks with enforced key citations:{' '}
              <span className="font-mono font-medium text-slate-900">
                {String(dashboard.reportBuilder.citedBlockCount)}/{String(dashboard.reportBuilder.blockCount)} blocks cited ({dashboard.reportBuilder.citationCoveragePct})
              </span>
            </p>
          </div>
          <div>
            <label htmlFor="report-template-select" className="block text-xs font-medium text-slate-600">
              Report template
            </label>
            <select
              id="report-template-select"
              value={templateId}
              onChange={(event) => props.onChangeTemplate(event.target.value as DashboardReportTemplateId)}
              className="mt-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              {TEMPLATE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <caption className="sr-only">Report Builder composed blocks and canonical key citations</caption>
            <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">Block Title</th>
                <th scope="col" className="px-3 py-2">Source Kind</th>
                <th scope="col" className="px-3 py-2">Citation Key</th>
                <th scope="col" className="px-3 py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {dashboard.reportBuilder.blocks.map((block) => (
                <tr key={block.id}>
                  <th scope="row" className="px-3 py-2 text-left font-medium text-slate-900">
                    {block.title}
                  </th>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{block.kind}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{block.citationKey}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums">
                    {block.formattedValue}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
