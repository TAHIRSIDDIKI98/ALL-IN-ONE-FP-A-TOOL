import { useMemo, useState, type ReactElement } from 'react';
import { generateFiscalYears, type CalendarKind } from '../../core/calendar/index.js';
import { EmptyState, ErrorState, LoadingState } from '../components/StateFrame.js';
import { useWorkspaceStore, type WorkspaceCompany } from '../state/workspaceStore.js';
import type { SpinePageProps } from './SignInPage.js';

export default function SetupWizardPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const { company, saveCompany } = useWorkspaceStore();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [companyName, setCompanyName] = useState(company?.name ?? '');
  const [currency, setCurrency] = useState<WorkspaceCompany['currency']>(company?.currency ?? 'USD');
  const [calendarKind, setCalendarKind] = useState<CalendarKind>(company?.calendarKind ?? '12month');
  const [fiscalYear, setFiscalYear] = useState(company?.fiscalYear ?? 2026);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const previewYears = useMemo(
    () =>
      generateFiscalYears({
        kind: calendarKind,
        startYear: fiscalYear,
        yearCount: 1,
      }),
    [calendarKind, fiscalYear],
  );

  if (forcedState === 'loading') {
    return <LoadingState label="Loading fiscal setup wizard..." />;
  }
  if (forcedState === 'error' || errorMsg !== null) {
    return (
      <ErrorState
        title="Company Setup Wizard"
        code="VALIDATION_FAILED"
        message={errorMsg ?? 'Setup wizard failed to initialize.'}
        onRetry={() => setErrorMsg(null)}
      />
    );
  }
  if (forcedState === 'empty' && !company) {
    return (
      <EmptyState
        title="Company Setup Wizard"
        disclosure="No company workspace is configured yet. Create a company name, base currency, and fiscal calendar to unlock imports."
        ctaLabel="Begin Company Setup"
        ctaPath="/setup"
        onNavigate={() => setStep(1)}
      />
    );
  }

  const step1Valid = companyName.trim().length >= 2;
  const periods = previewYears[0]?.periods ?? [];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Company Setup Wizard</h1>
          <p className="mt-1 text-sm text-slate-600">
            Step {step} of 4 · Fiscal periods are computed live by <span className="font-mono">/core/calendar</span>.
          </p>
        </div>
        {company && (
          <span className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-900">
            Active: {company.name} ({company.currency})
          </span>
        )}
      </div>

      {step === 1 && (
        <div className="mt-6 max-w-md space-y-4">
          <div>
            <label htmlFor="company-name" className="block text-sm font-medium text-slate-700">
              Company Name
            </label>
            <input
              id="company-name"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Northwind Components Inc."
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="base-currency" className="block text-sm font-medium text-slate-700">
              Base Currency (ISO 4217)
            </label>
            <select
              id="base-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as WorkspaceCompany['currency'])}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="USD">USD (scale 2)</option>
              <option value="EUR">EUR (scale 2)</option>
              <option value="GBP">GBP (scale 2)</option>
              <option value="INR">INR (scale 2)</option>
              <option value="JPY">JPY (scale 0)</option>
              <option value="KWD">KWD (scale 3)</option>
            </select>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 max-w-lg">
            <div>
              <label htmlFor="calendar-kind" className="block text-sm font-medium text-slate-700">
                Fiscal Calendar Kind
              </label>
              <select
                id="calendar-kind"
                value={calendarKind}
                onChange={(e) => setCalendarKind(e.target.value as CalendarKind)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="12month">12-Month Calendar</option>
                <option value="445">4-4-5 Retail</option>
                <option value="454">4-5-4 NRF</option>
                <option value="544">5-4-4 Retail</option>
                <option value="52_53">52/53-Week</option>
                <option value="13x4">13x4 (4-Week Periods)</option>
              </select>
            </div>
            <div>
              <label htmlFor="fiscal-year" className="block text-sm font-medium text-slate-700">
                Fiscal Year
              </label>
              <input
                id="fiscal-year"
                type="number"
                min={2020}
                max={2035}
                value={fiscalYear}
                onChange={(e) => setFiscalYear(Number.parseInt(e.target.value || '2026', 10))}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-left font-medium text-slate-700">
                <tr>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">Quarter</th>
                  <th className="px-3 py-2">Start Date</th>
                  <th className="px-3 py-2">End Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {periods.map((p) => (
                  <tr key={p.code}>
                    <td className="px-3 py-1.5 font-mono">{p.code}</td>
                    <td className="px-3 py-1.5">{p.label}</td>
                    <td className="px-3 py-1.5">Q{p.quarter}</td>
                    <td className="px-3 py-1.5 font-mono">{p.startDate}</td>
                    <td className="px-3 py-1.5 font-mono">{p.endDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-6 max-w-lg space-y-2 text-sm text-slate-700">
          <p className="font-medium text-slate-900">Opening Balance Sheet (Optional in Setup)</p>
          <p>
            No opening balance sheet CSV is staged yet. You can import opening trial balances directly in the Import Wizard.
          </p>
        </div>
      )}

      {step === 4 && (
        <div className="mt-6 max-w-lg rounded border border-slate-200 bg-slate-50 p-4 text-sm space-y-1">
          <div>
            <span className="font-medium">Company:</span> {companyName.trim()}
          </div>
          <div>
            <span className="font-medium">Currency:</span> {currency}
          </div>
          <div>
            <span className="font-medium">Calendar:</span> {calendarKind} · FY{fiscalYear} ({periods.length} periods)
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          disabled={step === 1}
          onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s))}
          className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
        >
          Back
        </button>
        {step < 4 ? (
          <button
            type="button"
            disabled={step === 1 && !step1Valid}
            onClick={() => setStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s))}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (!step1Valid) {
                setErrorMsg('Company name is required before saving workspace.');
                return;
              }
              saveCompany({
                name: companyName.trim(),
                currency,
                calendarKind,
                fiscalYear,
                calendarYears: previewYears,
              });
              onNavigate('/import');
            }}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Create Company &amp; Continue
          </button>
        )}
      </div>
    </section>
  );
}
