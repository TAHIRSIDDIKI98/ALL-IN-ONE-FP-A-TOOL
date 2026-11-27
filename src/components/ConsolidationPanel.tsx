import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { PeriodDateSchema } from '../../shared/temporal.js';
import {
  ApiClientError,
  createApiClient,
  type ConsolidationRunSummary,
  type ConsolidationWorkspaceResponse,
  type MonetaryRevaluationResponse,
} from '../api/client.js';
import {
  InlineEmptyState,
  InlineErrorState,
  LoadingState,
  PartialBanner,
} from './StateFrame.js';

export interface ConsolidationPanelProps {
  readonly companyId: string;
  readonly authToken: string;
  readonly periodCode: string;
  readonly fiscalYear: number;
  readonly forcedState?: 'loading' | 'error';
  readonly initialWorkspace?: ConsolidationWorkspaceResponse;
}

export function ConsolidationPanel({
  companyId,
  authToken,
  periodCode,
  fiscalYear,
  forcedState,
  initialWorkspace,
}: ConsolidationPanelProps): ReactElement {
  const [workspace, setWorkspace] = useState<ConsolidationWorkspaceResponse | null>(
    initialWorkspace ?? null,
  );
  const [loadState, setLoadState] = useState<'loading' | 'idle' | 'error'>(
    forcedState === 'loading'
      ? 'loading'
      : forcedState === 'error'
        ? 'error'
        : initialWorkspace !== undefined
          ? 'idle'
          : 'loading',
  );
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(
    forcedState === 'error'
      ? { code: 'CONSOLIDATION_LOAD_FAILED', message: 'Unable to load consolidation workspace.' }
      : null,
  );
  const [actionError, setActionError] = useState<{ code: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Add entity form
  const [entityCode, setEntityCode] = useState('');
  const [entityName, setEntityName] = useState('');
  const [entityCurrency, setEntityCurrency] = useState('GBP');
  const [parentEntityCode, setParentEntityCode] = useState('');

  // Ownership form
  const [ownParentCode, setOwnParentCode] = useState('');
  const [ownChildCode, setOwnChildCode] = useState('');
  const [ownPct, setOwnPct] = useState('100');
  const [ownMethod, setOwnMethod] = useState<'full' | 'equity' | 'cost'>('full');

  // FX rate form
  const [fxBase, setFxBase] = useState('GBP');
  const [fxQuote, setFxQuote] = useState('USD');
  const [fxType, setFxType] = useState<'closing' | 'average' | 'historical'>('closing');
  const [fxDate, setFxDate] = useState('2026-01-31');
  const [fxRate, setFxRate] = useState('1.2800');
  const [fxSource, setFxSource] = useState<'manual' | 'ecb' | 'fed' | 'bloomberg' | 'erp_feed'>('ecb');

  // IC rule form
  const [icFromEntity, setIcFromEntity] = useState('');
  const [icFromAccount, setIcFromAccount] = useState('1150');
  const [icToEntity, setIcToEntity] = useState('');
  const [icToAccount, setIcToAccount] = useState('2150');
  const [icRuleType, setIcRuleType] = useState<
    'ic_receivable_payable' | 'ic_revenue_expense' | 'ic_investment_equity' | 'ic_dividend' | 'ic_loan'
  >('ic_receivable_payable');
  const [icDescription, setIcDescription] = useState('Intercompany AR/AP elimination');

  // Consolidation run options
  const [reportingCurrency, setReportingCurrency] = useState('USD');
  const [activeRun, setActiveRun] = useState<ConsolidationRunSummary | null>(null);

  // FX2 Revaluation preview form
  const [revalEntity, setRevalEntity] = useState('');
  const [revalAccount, setRevalAccount] = useState('1100');
  const [revalAccountType, setRevalAccountType] = useState<'asset' | 'liability'>('asset');
  const [revalForeignCcy, setRevalForeignCcy] = useState('EUR');
  const [revalForeignAmount, setRevalForeignAmount] = useState('10000.00');
  const [revalBookingRate, setRevalBookingRate] = useState('1.0800');
  const [revalEndRate, setRevalEndRate] = useState('1.1000');
  const [revalSettled, setRevalSettled] = useState(false);
  const [revalSettlementRate, setRevalSettlementRate] = useState('1.0950');
  const [revalResult, setRevalResult] = useState<MonetaryRevaluationResponse | null>(null);

  const loadWorkspace = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      const ws = await createApiClient({ getToken: () => authToken }).getConsolidationWorkspace(
        companyId,
      );
      setWorkspace(ws);
      setReportingCurrency(ws.baseCurrency);
      setFxQuote(ws.baseCurrency);
      const firstCode = ws.entities[0]?.code ?? '';
      const secondCode = ws.entities[1]?.code ?? '';
      setParentEntityCode((prev) => prev || firstCode);
      setOwnParentCode((prev) => prev || firstCode);
      setOwnChildCode((prev) => prev || secondCode);
      setIcFromEntity((prev) => prev || firstCode);
      setIcToEntity((prev) => prev || secondCode);
      setRevalEntity((prev) => prev || firstCode);
      setActiveRun(ws.latestRun);
      setLoadState('idle');
    } catch (error: unknown) {
      setLoadState('error');
      setLoadError(
        error instanceof ApiClientError
          ? { code: error.code, message: error.message }
          : {
              code: 'INTERNAL_ERROR',
              message:
                error instanceof Error ? error.message : 'Unable to load consolidation workspace.',
            },
      );
    }
  }, [companyId, authToken]);

  useEffect(() => {
    if (forcedState !== undefined || initialWorkspace !== undefined) return;
    void loadWorkspace();
  }, [forcedState, initialWorkspace, loadWorkspace]);

  const runAction = async (fn: () => Promise<void>): Promise<void> => {
    setSubmitting(true);
    setActionError(null);
    try {
      await fn();
    } catch (error: unknown) {
      setActionError(
        error instanceof ApiClientError
          ? { code: error.code, message: error.message }
          : {
              code: 'INTERNAL_ERROR',
              message: error instanceof Error ? error.message : 'Consolidation action failed.',
            },
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loadState === 'loading' && workspace === null) {
    return <LoadingState label="Loading multi-entity consolidation workspace..." />;
  }

  if (loadState === 'error' && loadError !== null) {
    return (
      <InlineErrorState
        code={loadError.code}
        message={loadError.message}
        onRetry={() => {
          void loadWorkspace();
        }}
      />
    );
  }

  if (workspace === null) {
    return (
      <InlineEmptyState
        disclosure="Consolidation workspace is unavailable for this company."
        ctaLabel="Reload Consolidation"
        onAction={() => {
          void loadWorkspace();
        }}
      />
    );
  }

  const displayedRun = activeRun ?? workspace.latestRun;

  return (
    <div className="space-y-6" data-testid="consolidation-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-slate-50 p-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Multi-Entity, Multi-Currency &amp; Consolidation Tie-Out
          </h2>
          <p className="text-xs text-slate-600">
            Reporting currency {workspace.baseCurrency} · ASC 830 / IAS 21 computed CTA · zero-net IC
            eliminations · ASC 810 NCI · period {periodCode} (FY{fiscalYear}).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-slate-700" htmlFor="consol-reporting-ccy">
            Reporting CCY
          </label>
          <input
            id="consol-reporting-ccy"
            type="text"
            maxLength={3}
            value={reportingCurrency}
            onChange={(e) => setReportingCurrency(e.target.value.toUpperCase())}
            className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-mono uppercase"
          />
          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              void runAction(async () => {
                const run = await createApiClient({ getToken: () => authToken }).runConsolidation(
                  companyId,
                  {
                    periodCode,
                    fiscalYear,
                    reportingCurrency,
                  },
                );
                setActiveRun(run);
                await loadWorkspace();
              });
            }}
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting ? 'Running...' : `Run Consolidation (${periodCode})`}
          </button>
        </div>
      </div>

      {actionError !== null && (
        <InlineErrorState
          code={actionError.code}
          message={actionError.message}
          onRetry={() => setActionError(null)}
        />
      )}

      {displayedRun === null ? (
        <InlineEmptyState
          disclosure="No consolidation run has been executed yet. Add subsidiary entities, FX rates, and IC rules below, then run consolidation."
          ctaLabel={`Run Consolidation (${periodCode})`}
          onAction={() => {
            void runAction(async () => {
              const run = await createApiClient({ getToken: () => authToken }).runConsolidation(
                companyId,
                {
                  periodCode,
                  fiscalYear,
                  reportingCurrency,
                },
              );
              setActiveRun(run);
              await loadWorkspace();
            });
          }}
        />
      ) : (
        <div className="space-y-4">
          {displayedRun.hasUnmatchedIc && (
            <PartialBanner
              detail={`${displayedRun.unmatchedIcCount} intercompany rule(s) carried an unmatched residual difference; matched portions were eliminated and residuals remain quarantined in the consolidated balance.`}
            />
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              { label: 'Total Assets', value: displayedRun.totalAssets },
              { label: 'Total Liabilities', value: displayedRun.totalLiabilities },
              { label: 'Controlling Equity', value: displayedRun.controllingEquity },
              { label: 'Minority Interest (NCI)', value: displayedRun.minorityInterest },
              { label: 'Computed CTA', value: displayedRun.totalCta },
              { label: 'Consolidated Net Income', value: displayedRun.consolidatedNetIncome },
              { label: 'IC Eliminated', value: displayedRun.totalEliminations },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded border border-slate-200 bg-white p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {kpi.label}
                </div>
                <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900">
                  {displayedRun.reportingCurrency} {kpi.value}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <span
              className={`rounded px-2 py-0.5 font-mono font-semibold ${
                displayedRun.groupTbBalanced && displayedRun.groupBsBalanced
                  ? 'bg-emerald-100 text-emerald-900'
                  : 'bg-red-100 text-red-900'
              }`}
            >
              Tie-out: {displayedRun.groupTbBalanced && displayedRun.groupBsBalanced ? 'BALANCED' : 'UNBALANCED'}
            </span>
            <span className="font-mono text-slate-700">
              TB Dr {displayedRun.groupTbTotalDebit} = Cr {displayedRun.groupTbTotalCredit}
            </span>
            <span className="font-mono text-slate-700">
              A - (L + E) = {displayedRun.accountingEquationImbalance}
            </span>
            <span className="text-slate-600">
              Status: <strong>{displayedRun.status}</strong> · as of {displayedRun.asOfDate}
            </span>
          </div>

          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <caption className="bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-700">
                Entity FX Translation &amp; Computed CTA Breakdown (FX1 / A7)
              </caption>
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Entity</th>
                  <th className="px-3 py-2 text-left">Func CCY</th>
                  <th className="px-3 py-2 text-left">Method / %</th>
                  <th className="px-3 py-2 text-right">Closing</th>
                  <th className="px-3 py-2 text-right">Average</th>
                  <th className="px-3 py-2 text-right">Historical</th>
                  <th className="px-3 py-2 text-right">Translated Assets</th>
                  <th className="px-3 py-2 text-right">Translated NI</th>
                  <th className="px-3 py-2 text-right">Opening CTA</th>
                  <th className="px-3 py-2 text-right">NI Rate CTA</th>
                  <th className="px-3 py-2 text-right">Total CTA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white font-mono tabular-nums">
                {displayedRun.entityTranslations.map((row) => (
                  <tr key={row.entityId}>
                    <td className="px-3 py-2 font-sans font-medium text-slate-900">
                      {row.entityCode} ({row.entityName})
                    </td>
                    <td className="px-3 py-2">{row.functionalCurrency}</td>
                    <td className="px-3 py-2">
                      {row.method} ({row.ownershipPct}%)
                    </td>
                    <td className="px-3 py-2 text-right">{row.closingRate}</td>
                    <td className="px-3 py-2 text-right">{row.averageRate}</td>
                    <td className="px-3 py-2 text-right">{row.historicalRate}</td>
                    <td className="px-3 py-2 text-right">{row.translatedAssets}</td>
                    <td className="px-3 py-2 text-right">{row.translatedNetIncome}</td>
                    <td className="px-3 py-2 text-right">{row.openingEquityRateEffect}</td>
                    <td className="px-3 py-2 text-right">{row.netIncomeRateEffect}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">
                      {row.totalCta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {displayedRun.icReconciliations.length > 0 && (
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <caption className="bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-700">
                  Intercompany Elimination &amp; Residual Quarantine Log (FX3)
                </caption>
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Rule</th>
                    <th className="px-3 py-2 text-left">From Leg</th>
                    <th className="px-3 py-2 text-left">To Leg</th>
                    <th className="px-3 py-2 text-right">From Balance</th>
                    <th className="px-3 py-2 text-right">To Balance</th>
                    <th className="px-3 py-2 text-right">Eliminated</th>
                    <th className="px-3 py-2 text-right">Residual</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white font-mono tabular-nums">
                  {displayedRun.icReconciliations.map((ic) => (
                    <tr key={ic.ruleId}>
                      <td className="px-3 py-2 font-sans text-slate-800">{ic.description}</td>
                      <td className="px-3 py-2">
                        {ic.fromEntityCode}:{ic.fromAccountCode}
                      </td>
                      <td className="px-3 py-2">
                        {ic.toEntityCode}:{ic.toAccountCode}
                      </td>
                      <td className="px-3 py-2 text-right">{ic.fromTranslatedBalance}</td>
                      <td className="px-3 py-2 text-right">{ic.toTranslatedBalance}</td>
                      <td className="px-3 py-2 text-right">{ic.eliminatedAmount}</td>
                      <td className="px-3 py-2 text-right">{ic.unmatchedDifference}</td>
                      <td className="px-3 py-2 font-sans">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                            ic.status === 'matched'
                              ? 'bg-emerald-100 text-emerald-900'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {ic.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {displayedRun.minorityInterests.length > 0 && (
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <caption className="bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-700">
                  Minority Interest (NCI) Allocation Schedule (FX4)
                </caption>
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Subsidiary</th>
                    <th className="px-3 py-2 text-right">Parent %</th>
                    <th className="px-3 py-2 text-right">NCI %</th>
                    <th className="px-3 py-2 text-right">Sub Net Equity</th>
                    <th className="px-3 py-2 text-right">NCI Net Income</th>
                    <th className="px-3 py-2 text-right">NCI Equity Share</th>
                    <th className="px-3 py-2 text-right">Total NCI Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white font-mono tabular-nums">
                  {displayedRun.minorityInterests.map((nci) => (
                    <tr key={nci.entityId}>
                      <td className="px-3 py-2 font-sans font-medium text-slate-900">
                        {nci.entityCode} ({nci.entityName})
                      </td>
                      <td className="px-3 py-2 text-right">{nci.ownershipPct}%</td>
                      <td className="px-3 py-2 text-right">{nci.minorityPct}%</td>
                      <td className="px-3 py-2 text-right">{nci.subsidiaryNetEquity}</td>
                      <td className="px-3 py-2 text-right">{nci.nciNetIncomeShare}</td>
                      <td className="px-3 py-2 text-right">{nci.nciEquityShare}</td>
                      <td className="px-3 py-2 text-right font-semibold">{nci.nciTotalBalance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Entities ({workspace.entities.length}) &amp; Ownership ({workspace.ownerships.length})
          </h3>
          <ul className="space-y-1 text-xs text-slate-700">
            {workspace.entities.map((ent) => (
              <li key={ent.id} className="flex items-center justify-between font-mono">
                <span>
                  {ent.code} — {ent.name}
                </span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5">{ent.currency}</span>
              </li>
            ))}
          </ul>
          <form
            className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100"
            onSubmit={(e) => {
              e.preventDefault();
              void runAction(async () => {
                await createApiClient({ getToken: () => authToken }).createConsolidationEntity(
                  companyId,
                  {
                    code: entityCode,
                    name: entityName,
                    currency: entityCurrency,
                    parentEntityCode: parentEntityCode || null,
                  },
                );
                setEntityCode('');
                setEntityName('');
                await loadWorkspace();
              });
            }}
          >
            <input
              aria-label="Entity code"
              placeholder="Code (e.g. ENT-UK)"
              value={entityCode}
              onChange={(e) => setEntityCode(e.target.value)}
              required
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <input
              aria-label="Entity name"
              placeholder="Entity name"
              value={entityName}
              onChange={(e) => setEntityName(e.target.value)}
              required
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <input
              aria-label="Entity currency"
              placeholder="CCY (GBP)"
              maxLength={3}
              value={entityCurrency}
              onChange={(e) => setEntityCurrency(e.target.value.toUpperCase())}
              required
              className="rounded border border-slate-300 px-2 py-1 text-xs font-mono uppercase"
            />
            <input
              aria-label="Parent entity code"
              placeholder="Parent code (optional)"
              value={parentEntityCode}
              onChange={(e) => setParentEntityCode(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <button
              type="submit"
              disabled={submitting}
              className="col-span-2 rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
            >
              Add Subsidiary Entity
            </button>
          </form>

          <form
            className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100"
            onSubmit={(e) => {
              e.preventDefault();
              void runAction(async () => {
                await createApiClient({ getToken: () => authToken }).upsertEntityOwnership(
                  companyId,
                  {
                    parentEntityCode: ownParentCode,
                    childEntityCode: ownChildCode,
                    ownershipPct: ownPct,
                    method: ownMethod,
                  },
                );
                await loadWorkspace();
              });
            }}
          >
            <input
              aria-label="Ownership parent code"
              placeholder="Parent code"
              value={ownParentCode}
              onChange={(e) => setOwnParentCode(e.target.value)}
              required
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <input
              aria-label="Ownership child code"
              placeholder="Child code"
              value={ownChildCode}
              onChange={(e) => setOwnChildCode(e.target.value)}
              required
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <input
              aria-label="Ownership percentage"
              placeholder="Ownership %"
              value={ownPct}
              onChange={(e) => setOwnPct(e.target.value)}
              required
              className="rounded border border-slate-300 px-2 py-1 text-xs font-mono"
            />
            <select
              aria-label="Consolidation method"
              value={ownMethod}
              onChange={(e) => setOwnMethod(e.target.value as 'full' | 'equity' | 'cost')}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="full">full</option>
              <option value="equity">equity</option>
              <option value="cost">cost</option>
            </select>
            <button
              type="submit"
              disabled={submitting}
              className="col-span-2 rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
            >
              Save Ownership &amp; Method
            </button>
          </form>
        </div>

        <div className="rounded border border-slate-200 bg-white p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Sourced FX Rates ({workspace.fxRates.length}) &amp; IC Rules ({workspace.icRules.length})
          </h3>
          <form
            className="grid grid-cols-3 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runAction(async () => {
                await createApiClient({ getToken: () => authToken }).upsertFxRate(companyId, {
                  baseCurrency: fxBase,
                  quoteCurrency: fxQuote,
                  rateType: fxType,
                  asOfDate: PeriodDateSchema.parse(fxDate),
                  rate: fxRate,
                  source: fxSource,
                });
                await loadWorkspace();
              });
            }}
          >
            <input
              aria-label="FX base currency"
              value={fxBase}
              maxLength={3}
              onChange={(e) => setFxBase(e.target.value.toUpperCase())}
              className="rounded border border-slate-300 px-2 py-1 text-xs font-mono uppercase"
            />
            <input
              aria-label="FX quote currency"
              value={fxQuote}
              maxLength={3}
              onChange={(e) => setFxQuote(e.target.value.toUpperCase())}
              className="rounded border border-slate-300 px-2 py-1 text-xs font-mono uppercase"
            />
            <select
              aria-label="FX rate type"
              value={fxType}
              onChange={(e) => setFxType(e.target.value as 'closing' | 'average' | 'historical')}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="closing">closing</option>
              <option value="average">average</option>
              <option value="historical">historical</option>
            </select>
            <input
              aria-label="FX as-of date"
              type="date"
              value={fxDate}
              onChange={(e) => setFxDate(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-xs font-mono"
            />
            <input
              aria-label="FX rate value"
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-xs font-mono"
            />
            <select
              aria-label="FX rate source"
              value={fxSource}
              onChange={(e) =>
                setFxSource(
                  e.target.value as 'manual' | 'ecb' | 'fed' | 'bloomberg' | 'erp_feed',
                )
              }
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="ecb">ecb</option>
              <option value="fed">fed</option>
              <option value="bloomberg">bloomberg</option>
              <option value="erp_feed">erp_feed</option>
              <option value="manual">manual</option>
            </select>
            <button
              type="submit"
              disabled={submitting}
              className="col-span-3 rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
            >
              Save Sourced FX Rate
            </button>
          </form>

          <form
            className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100"
            onSubmit={(e) => {
              e.preventDefault();
              void runAction(async () => {
                await createApiClient({ getToken: () => authToken }).createIntercompanyRule(
                  companyId,
                  {
                    fromEntityCode: icFromEntity,
                    fromAccountCode: icFromAccount,
                    toEntityCode: icToEntity,
                    toAccountCode: icToAccount,
                    ruleType: icRuleType,
                    description: icDescription,
                  },
                );
                await loadWorkspace();
              });
            }}
          >
            <input
              aria-label="IC from entity"
              placeholder="From entity"
              value={icFromEntity}
              onChange={(e) => setIcFromEntity(e.target.value)}
              required
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <input
              aria-label="IC from account"
              placeholder="From account"
              value={icFromAccount}
              onChange={(e) => setIcFromAccount(e.target.value)}
              required
              className="rounded border border-slate-300 px-2 py-1 text-xs font-mono"
            />
            <input
              aria-label="IC to entity"
              placeholder="To entity"
              value={icToEntity}
              onChange={(e) => setIcToEntity(e.target.value)}
              required
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <input
              aria-label="IC to account"
              placeholder="To account"
              value={icToAccount}
              onChange={(e) => setIcToAccount(e.target.value)}
              required
              className="rounded border border-slate-300 px-2 py-1 text-xs font-mono"
            />
            <select
              aria-label="IC rule type"
              value={icRuleType}
              onChange={(e) =>
                setIcRuleType(
                  e.target.value as
                    | 'ic_receivable_payable'
                    | 'ic_revenue_expense'
                    | 'ic_investment_equity'
                    | 'ic_dividend'
                    | 'ic_loan',
                )
              }
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="ic_receivable_payable">ic_receivable_payable</option>
              <option value="ic_revenue_expense">ic_revenue_expense</option>
              <option value="ic_investment_equity">ic_investment_equity</option>
              <option value="ic_dividend">ic_dividend</option>
              <option value="ic_loan">ic_loan</option>
            </select>
            <input
              aria-label="IC rule description"
              value={icDescription}
              onChange={(e) => setIcDescription(e.target.value)}
              required
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <button
              type="submit"
              disabled={submitting}
              className="col-span-2 rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
            >
              Add Intercompany Elimination Rule
            </button>
          </form>
        </div>
      </div>

      <div className="rounded border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">
          Monetary FX Revaluation Preview (FX2 Realized vs. Unrealized)
        </h3>
        <form
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            void runAction(async () => {
              const res = await createApiClient({ getToken: () => authToken }).previewFxRevaluation(
                companyId,
                {
                  functionalCurrency: workspace.baseCurrency,
                  items: [
                    {
                      itemKey: 'FX2-PREVIEW-1',
                      entityCode: revalEntity || (workspace.entities[0]?.code ?? 'HQ'),
                      accountCode: revalAccount,
                      accountType: revalAccountType,
                      foreignCurrency: revalForeignCcy,
                      functionalCurrency: workspace.baseCurrency,
                      foreignAmount: revalForeignAmount,
                      bookingRate: revalBookingRate,
                      periodEndRate: revalEndRate,
                      settled: revalSettled,
                      ...(revalSettled ? { settlementRate: revalSettlementRate } : {}),
                    },
                  ],
                },
              );
              setRevalResult(res);
            });
          }}
        >
          <input
            aria-label="Revaluation entity"
            value={revalEntity}
            onChange={(e) => setRevalEntity(e.target.value)}
            placeholder="Entity"
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <input
            aria-label="Revaluation account"
            value={revalAccount}
            onChange={(e) => setRevalAccount(e.target.value)}
            placeholder="Account"
            className="rounded border border-slate-300 px-2 py-1 text-xs font-mono"
          />
          <select
            aria-label="Revaluation account type"
            value={revalAccountType}
            onChange={(e) => setRevalAccountType(e.target.value as 'asset' | 'liability')}
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="asset">asset</option>
            <option value="liability">liability</option>
          </select>
          <input
            aria-label="Revaluation foreign currency"
            value={revalForeignCcy}
            maxLength={3}
            onChange={(e) => setRevalForeignCcy(e.target.value.toUpperCase())}
            className="rounded border border-slate-300 px-2 py-1 text-xs font-mono uppercase"
          />
          <input
            aria-label="Revaluation foreign amount"
            value={revalForeignAmount}
            onChange={(e) => setRevalForeignAmount(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-xs font-mono"
          />
          <input
            aria-label="Revaluation booking rate"
            value={revalBookingRate}
            onChange={(e) => setRevalBookingRate(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-xs font-mono"
          />
          <input
            aria-label="Revaluation period-end rate"
            value={revalEndRate}
            onChange={(e) => setRevalEndRate(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-xs font-mono"
          />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={revalSettled}
                onChange={(e) => setRevalSettled(e.target.checked)}
              />
              Settled
            </label>
            {revalSettled && (
              <input
                aria-label="Settlement rate"
                value={revalSettlementRate}
                onChange={(e) => setRevalSettlementRate(e.target.value)}
                className="w-20 rounded border border-slate-300 px-2 py-1 text-xs font-mono"
              />
            )}
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="col-span-2 sm:col-span-4 rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
          >
            Preview FX2 Revaluation
          </button>
        </form>
        {revalResult !== null && (
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs font-mono">
            Realized {revalResult.realizedTotal} · Unrealized {revalResult.unrealizedTotal} · Net{' '}
            {revalResult.netRevaluationTotal} · Journal balanced:{' '}
            {revalResult.journalBalanced ? 'true' : 'false'}
          </div>
        )}
      </div>
    </div>
  );
}
