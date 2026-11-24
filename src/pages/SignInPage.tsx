import { useState, type ReactElement } from 'react';
import type { SpineRoutePath } from '../../shared/spine.js';
import { ErrorState, LoadingState } from '../components/StateFrame.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';

export interface SpinePageProps {
  readonly onNavigate: (path: SpineRoutePath) => void;
  readonly forcedState?: 'loading' | 'empty' | 'error';
}

export default function SignInPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const {
    sessionState,
    sessionError,
    userEmail,
    setSessionLoading,
    setSessionError,
    signInSuccess,
    signOut,
  } = useWorkspaceStore();

  const [emailInput, setEmailInput] = useState('');

  const checkServerSession = async (): Promise<void> => {
    setSessionLoading();
    try {
      const res = await fetch('/api/session/workspace');
      if (!res.ok) {
        const body = (await res.json()) as { error?: { code?: string; userMessage?: string } };
        const code = body.error?.code ?? 'SESSION_REQUIRED';
        const msg = body.error?.userMessage ?? 'Authentication session required.';
        setSessionError(`${code}: ${msg}`);
        return;
      }
      signInSuccess(emailInput.trim() || 'session-verified@onefpa.local');
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : 'Unable to reach workspace session endpoint.');
    }
  };

  if (forcedState === 'loading' || sessionState === 'loading') {
    return <LoadingState label="Verifying authentication session..." />;
  }

  if (forcedState === 'error' || (sessionState === 'error' && sessionError !== null)) {
    return (
      <ErrorState
        title="Sign in to OneFP&A"
        code="SESSION_REQUIRED"
        message={sessionError ?? 'Session verification failed. Connect an authorized workspace session.'}
        onRetry={() => {
          void checkServerSession();
        }}
      />
    );
  }

  if (userEmail !== null) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="text-xl font-semibold text-slate-900">Signed in to OneFP&amp;A</h1>
        <p className="mt-2 text-sm text-slate-600">
          Active session: <span className="font-mono font-medium text-slate-900">{userEmail}</span>
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onNavigate('/setup')}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Continue to Setup Wizard
          </button>
          <button
            type="button"
            onClick={signOut}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 max-w-lg">
      <h1 className="text-xl font-semibold text-slate-900">Sign in to OneFP&amp;A</h1>
      <p className="mt-2 text-sm text-slate-600">
        Authentication feed required: connect your Firebase Google session or verify server token to load your company workspace.
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = emailInput.trim();
          if (trimmed.length === 0) {
            void checkServerSession();
            return;
          }
          signInSuccess(trimmed);
          onNavigate('/setup');
        }}
      >
        <div>
          <label htmlFor="signin-email" className="block text-sm font-medium text-slate-700">
            Workspace email (required to initialize local or federated session)
          </label>
          <input
            id="signin-email"
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="finance.lead@company.example"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Continue to Setup Wizard
          </button>
          <button
            type="button"
            onClick={() => {
              void checkServerSession();
            }}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Check server session
          </button>
        </div>
      </form>
    </section>
  );
}
