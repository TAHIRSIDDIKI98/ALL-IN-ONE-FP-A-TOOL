import type { ReactElement } from 'react';
import type { SpineRoutePath } from '../../shared/spine.js';

export function LoadingState(props: { readonly label: string }): ReactElement {
  return (
    <section
      aria-busy="true"
      className="rounded-lg border border-slate-200 bg-white p-6"
    >
      <div role="status" aria-live="polite" className="text-sm font-medium text-slate-700">
        {props.label}
      </div>
      <div className="mt-4 space-y-3" aria-hidden="true">
        <div className="h-5 w-48 rounded bg-slate-200" />
        <div className="h-4 w-full rounded bg-slate-100" />
        <div className="h-4 w-5/6 rounded bg-slate-100" />
      </div>
    </section>
  );
}

export function EmptyState(props: {
  readonly title: string;
  readonly disclosure: string;
  readonly ctaLabel: string;
  readonly ctaPath: SpineRoutePath;
  readonly onNavigate: (path: SpineRoutePath) => void;
}): ReactElement {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-semibold text-slate-900">{props.title}</h1>
      <p className="mt-2 text-sm text-slate-600">{props.disclosure}</p>
      <div className="mt-4">
        <button
          type="button"
          onClick={() => props.onNavigate(props.ctaPath)}
          className="inline-flex items-center rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:outline-2 focus:outline-offset-2 focus:outline-slate-900"
        >
          {props.ctaLabel}
        </button>
      </div>
    </section>
  );
}

export function ErrorState(props: {
  readonly title: string;
  readonly code: string;
  readonly message: string;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-6">
      <h1 className="text-xl font-semibold text-red-900">{props.title}</h1>
      <div role="alert" className="mt-2 text-sm text-red-800">
        <span className="font-mono font-semibold">[{props.code}]</span> {props.message}
      </div>
      <div className="mt-4">
        <button
          type="button"
          onClick={props.onRetry}
          className="inline-flex items-center rounded bg-red-900 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 focus:outline-2 focus:outline-offset-2 focus:outline-red-900"
        >
          Retry failed action
        </button>
      </div>
    </section>
  );
}

export function PartialBanner(props: { readonly detail: string }): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      <span className="font-semibold">Partial workspace data:</span> {props.detail}
    </div>
  );
}

/**
 * In-screen empty card (MASTER_PROMPT §9.2). Used when a SCREEN owns its `h1` and one view inside it
 * has nothing to show: the mounted heading stays on screen, and this card supplies the honest
 * disclosure plus one working call to action — never a fabricated record or a zero-for-absence.
 */
export function InlineEmptyState(props: {
  readonly disclosure: string;
  readonly ctaLabel: string;
  readonly onAction: () => void;
}): ReactElement {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <p className="text-sm text-slate-600">{props.disclosure}</p>
      <div className="mt-4">
        <button
          type="button"
          onClick={props.onAction}
          className="inline-flex items-center rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:outline-2 focus:outline-offset-2 focus:outline-slate-900"
        >
          {props.ctaLabel}
        </button>
      </div>
    </section>
  );
}

/**
 * In-screen error card (§9.2). Carries the server's typed code and message verbatim and retries the
 * exact action that failed; the screen's `h1` stays mounted so the failure never replaces the page.
 */
export function InlineErrorState(props: {
  readonly code: string;
  readonly message: string;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-6">
      <div role="alert" className="text-sm text-red-800">
        <span className="font-mono font-semibold">[{props.code}]</span> {props.message}
      </div>
      <div className="mt-3">
        <button
          type="button"
          onClick={props.onRetry}
          className="inline-flex items-center rounded bg-red-900 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 focus:outline-2 focus:outline-offset-2 focus:outline-red-900"
        >
          Retry failed action
        </button>
      </div>
    </section>
  );
}
