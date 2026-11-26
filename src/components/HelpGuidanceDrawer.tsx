import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  SUPPORTED_DISPLAY_TIMEZONES,
  formatUtcInstantForDisplay,
  getScreenHelp,
  translateMessage,
  type SupportedLocale,
} from '../../shared/guidance.js';
import type { OnboardingChecklistResponse } from '../../shared/onboarding.js';
import { SPINE_ROUTE_DEFS, type SpineRoutePath } from '../../shared/spine.js';
import { ApiClientError, createApiClient } from '../api/client.js';
import type { WorkspaceCompany } from '../state/workspaceStore.js';
import { InlineErrorState, LoadingState } from './StateFrame.js';

export interface HelpGuidanceDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly currentPath: SpineRoutePath;
  readonly company: WorkspaceCompany | null;
  readonly authToken: string | null;
  readonly displayLocale: SupportedLocale;
  readonly displayTimeZone: string;
  readonly onChangeLocale: (locale: SupportedLocale) => void;
  readonly onChangeTimeZone: (timeZone: string) => void;
  readonly onNavigate: (path: SpineRoutePath) => void;
  readonly initialChecklist?: OnboardingChecklistResponse | null;
  readonly initialError?: { readonly code: string; readonly message: string } | null;
  readonly initialBusy?: boolean;
}

const REFERENCE_UTC_AUDIT_INSTANT = '2026-11-26T00:00:00Z';

export function HelpGuidanceDrawer(props: HelpGuidanceDrawerProps): ReactElement | null {
  const {
    isOpen,
    onClose,
    currentPath,
    company,
    authToken,
    displayLocale,
    displayTimeZone,
    onChangeLocale,
    onChangeTimeZone,
    onNavigate,
  } = props;

  const [checklist, setChecklist] = useState<OnboardingChecklistResponse | null>(
    props.initialChecklist ?? null,
  );
  const [errorState, setErrorState] = useState<{ readonly code: string; readonly message: string } | null>(
    props.initialError ?? null,
  );
  const [busy, setBusy] = useState<boolean>(props.initialBusy ?? false);

  const loadChecklist = useCallback(async (): Promise<void> => {
    if (!company || !authToken) return;
    setBusy(true);
    setErrorState(null);
    try {
      const client = createApiClient({ getToken: () => authToken });
      const loaded = await client.getOnboardingChecklist(company.id);
      setChecklist(loaded);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrorState({ code: error.code, message: error.message });
      } else {
        setErrorState({
          code: 'CHECKLIST_LOAD_FAILED',
          message: 'Unable to load the workspace onboarding checklist.',
        });
      }
    } finally {
      setBusy(false);
    }
  }, [company, authToken]);

  const signOffChecklist = useCallback(async (): Promise<void> => {
    if (!company || !authToken) return;
    setBusy(true);
    setErrorState(null);
    try {
      const client = createApiClient({ getToken: () => authToken });
      const updated = await client.signOffOnboardingChecklist(company.id);
      setChecklist(updated);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrorState({ code: error.code, message: error.message });
      } else {
        setErrorState({
          code: 'CHECKLIST_SIGNOFF_FAILED',
          message: 'Unable to sign off the onboarding checklist.',
        });
      }
    } finally {
      setBusy(false);
    }
  }, [company, authToken]);

  useEffect(() => {
    if (
      isOpen &&
      company !== null &&
      authToken !== null &&
      props.initialChecklist === undefined &&
      props.initialError === undefined
    ) {
      void loadChecklist();
    }
  }, [isOpen, company, authToken, props.initialChecklist, props.initialError, loadChecklist]);

  if (!isOpen) {
    return null;
  }

  const matchedRoute = SPINE_ROUTE_DEFS.find((r) => r.path === currentPath) ?? SPINE_ROUTE_DEFS[0]!;
  const help = getScreenHelp(matchedRoute.id, displayLocale);
  const formattedReferenceClock = formatUtcInstantForDisplay(
    REFERENCE_UTC_AUDIT_INSTANT,
    displayLocale,
    displayTimeZone,
  );
  const canSignOff =
    checklist !== null &&
    checklist.readyForSignoff &&
    !checklist.isComplete &&
    (checklist.actorRole === 'owner' || checklist.actorRole === 'editor');

  return (
    <aside
      aria-label={translateMessage(displayLocale, 'help.drawer.title')}
      data-help-key={help.helpKey}
      className="w-full md:w-96 md:shrink-0 border-t md:border-t-0 md:border-s border-slate-200 bg-white p-5 space-y-5 overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {translateMessage(displayLocale, 'help.drawer.title')}
          </h2>
          <p className="mt-0.5 text-xs font-mono text-slate-500">{help.helpKey}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          {translateMessage(displayLocale, 'help.drawer.closeButton')}
        </button>
      </div>

      <section className="space-y-3 rounded border border-slate-200 bg-slate-50 p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {translateMessage(displayLocale, 'help.drawer.screenHelpHeading')}
        </h3>
        <p className="text-sm font-semibold text-slate-900">{help.title}</p>
        <p className="text-xs leading-relaxed text-slate-700">{help.summary}</p>
        <div className="text-xs text-slate-700">
          <span className="font-semibold text-slate-900">
            {translateMessage(displayLocale, 'help.drawer.whatToCheckLabel')}:{' '}
          </span>
          {help.whatToCheck}
        </div>
        <div className="text-xs text-slate-700">
          <span className="font-semibold text-slate-900">
            {translateMessage(displayLocale, 'help.drawer.nextStepLabel')}:{' '}
          </span>
          {help.nextStep}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 rounded border border-slate-200 p-3">
        <label className="block text-xs font-medium text-slate-700">
          <span className="block mb-1">{translateMessage(displayLocale, 'help.drawer.localeLabel')}</span>
          <select
            aria-label={translateMessage(displayLocale, 'help.drawer.localeLabel')}
            value={displayLocale}
            onChange={(e) => onChangeLocale(e.target.value as SupportedLocale)}
            className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
          >
            <option value="en-US">English (en-US)</option>
            <option value="ar-SA">العربية (ar-SA, RTL)</option>
            <option value="pseudo">Pseudolocale (pseudo)</option>
          </select>
        </label>

        <label className="block text-xs font-medium text-slate-700">
          <span className="block mb-1">{translateMessage(displayLocale, 'help.drawer.timezoneLabel')}</span>
          <select
            aria-label={translateMessage(displayLocale, 'help.drawer.timezoneLabel')}
            value={displayTimeZone}
            onChange={(e) => onChangeTimeZone(e.target.value)}
            className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
          >
            {SUPPORTED_DISPLAY_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>

        <div className="text-xs text-slate-600">
          <span className="font-medium text-slate-800">
            {translateMessage(displayLocale, 'help.drawer.anchorClockLabel')}:{' '}
          </span>
          <span className="font-mono">{formattedReferenceClock}</span>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
            {translateMessage(displayLocale, 'help.drawer.checklistHeading')}
          </h3>
          {company !== null && authToken !== null && (
            <button
              type="button"
              onClick={() => {
                void loadChecklist();
              }}
              className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {translateMessage(displayLocale, 'help.drawer.reloadChecklist')}
            </button>
          )}
        </div>

        {company === null || authToken === null ? (
          <p className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            {translateMessage(displayLocale, 'help.drawer.noCompanyHint')}
          </p>
        ) : busy ? (
          <LoadingState label="Checking persisted onboarding prerequisites..." />
        ) : errorState !== null ? (
          <InlineErrorState
            code={errorState.code}
            message={errorState.message}
            onRetry={() => {
              void loadChecklist();
            }}
          />
        ) : checklist === null ? (
          <p className="text-xs text-slate-600">
            {translateMessage(displayLocale, 'help.drawer.noCompanyHint')}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <span className="font-medium text-slate-700">
                {translateMessage(displayLocale, 'help.drawer.progressLabel')}
              </span>
              <span className="font-mono font-semibold text-slate-900">
                {checklist.completedCount}/{checklist.totalCount}
              </span>
            </div>

            {checklist.isComplete && (
              <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                <p className="font-semibold">
                  {translateMessage(displayLocale, 'help.drawer.completedBadge')}
                </p>
                {checklist.signedOffAt !== null && (
                  <p className="mt-1 font-mono text-emerald-800">
                    {formatUtcInstantForDisplay(
                      checklist.signedOffAt,
                      displayLocale,
                      displayTimeZone,
                    )}
                    {checklist.signedOffByName ? ` · ${checklist.signedOffByName}` : ''}
                  </p>
                )}
              </div>
            )}

            <ol className="space-y-2">
              {checklist.steps.map((step, index) => (
                <li
                  key={step.id}
                  data-checklist-step={step.id}
                  className={`rounded border p-3 text-xs ${
                    step.done
                      ? 'border-emerald-200 bg-emerald-50/40'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-900">
                      {index + 1}. {translateMessage(displayLocale, `checklist.step.${step.id}.title`)}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                        step.done
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {step.done ? 'DONE' : 'PENDING'}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600">
                    {translateMessage(displayLocale, `checklist.step.${step.id}.description`)}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-700">{step.evidence}</p>
                  {!step.done && step.id !== 'owner_signoff' && (
                    <button
                      type="button"
                      onClick={() => onNavigate(step.actionPath)}
                      className="mt-2 rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100"
                    >
                      Open {step.actionPath}
                    </button>
                  )}
                </li>
              ))}
            </ol>

            {canSignOff && (
              <button
                type="button"
                onClick={() => {
                  void signOffChecklist();
                }}
                className="w-full rounded bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                {translateMessage(displayLocale, 'help.drawer.completeButton')}
              </button>
            )}
          </div>
        )}
      </section>
    </aside>
  );
}
