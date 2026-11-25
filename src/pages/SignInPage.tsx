import { useState, type ReactElement } from 'react';
import type { SpineRoutePath } from '../../shared/spine.js';
import { ApiClientError, createApiClient } from '../api/client.js';
import { ErrorState, LoadingState } from '../components/StateFrame.js';
import { useWorkspaceStore } from '../state/workspaceStore.js';

export interface SpinePageProps {
  readonly onNavigate: (path: SpineRoutePath) => void;
  readonly forcedState?: 'loading' | 'empty' | 'error';
}

export default function SignInPage({ onNavigate, forcedState }: SpinePageProps): ReactElement {
  const {
    authToken,
    sessionState,
    sessionError,
    userEmail,
    company,
    setAuthToken,
    setSessionLoading,
    setSessionError,
    signInSuccess,
    signOut,
    saveCompany,
  } = useWorkspaceStore();

  const [emailInput, setEmailInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Real sign-in: mint a sandbox session token, then load the workspace it authorizes. The token is
   * kept in memory only, and the company (if any) comes from the server, never from the form.
   */
  const signIn = async (email: string, displayName: string): Promise<void> => {
    setSessionLoading();
    setIsSubmitting(true);
    try {
      const client = createApiClient({ getToken: () => authToken });
      const minted = await client.signInSandboxToken({ email, displayName });
      setAuthToken(minted.token);

      const authed = createApiClient({ getToken: () => minted.token });
      const session = await authed.getSessionWorkspace();
      const serverCompany = session.companies[0];
      if (serverCompany !== undefined) {
        const workspace = session.workspace ?? (await authed.getCompanyWorkspace(serverCompany.id));
        const firstPeriod = workspace.periods[0];
        saveCompany({
          id: serverCompany.id,
          name: serverCompany.name,
          currency: serverCompany.baseCurrency as 'USD',
          calendarKind: '12month',
          fiscalYear: firstPeriod?.fiscalYear ?? new Date().getUTCFullYear(),
          calendarYears: [],
          periodCount: workspace.periods.length,
        });
      }
      signInSuccess(session.identity.email);
      onNavigate(serverCompany === undefined ? '/setup' : '/import');
    } catch (error) {
      if (error instanceof ApiClientError) {
        setSessionError(`${error.code}: ${error.message}`);
      } else {
        setSessionError(error instanceof Error ? error.message : 'Unable to reach the session endpoint.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (forcedState === 'loading' || sessionState === 'loading' || isSubmitting) {
    return <LoadingState label="Verifying authentication session..." />;
  }

  if (forcedState === 'error' || (sessionState === 'error' && sessionError !== null)) {
    return (
      <ErrorState
        title="Sign in to OneFP&A"
        code={sessionError?.split(':')[0] ?? 'SESSION_REQUIRED'}
        message={sessionError?.split(': ').slice(1).join(': ') ?? 'Session verification failed.'}
        onRetry={() => {
          setSessionError('');
          void signIn(emailInput.trim() || 'sandbox@onefpa.test', displayNameInput.trim() || 'Sandbox User');
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
        <p className="mt-1 text-sm text-slate-600">
          {company === null
            ? 'No company workspace yet — create one in the setup wizard.'
            : `Company: ${company.name} (${company.currency}) · ${company.periodCount} fiscal periods`}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onNavigate(company === null ? '/setup' : '/import')}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {company === null ? 'Continue to Setup Wizard' : 'Continue to Import Wizard'}
          </button>
          <button
            type="button"
            onClick={() => {
              signOut();
              setEmailInput('');
            }}
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
        Sign-in mints a server-verified session token and loads your company workspace from the API.
        The sandbox issuer is only available when the server is configured with{' '}
        <span className="font-mono">SANDBOX_AUTH_SECRET</span>; otherwise sign-in reports the server&apos;s typed
        error.
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void signIn(
            emailInput.trim() || 'sandbox@onefpa.test',
            displayNameInput.trim() || 'Sandbox User',
          );
        }}
      >
        <div>
          <label htmlFor="signin-email" className="block text-sm font-medium text-slate-700">
            Workspace email
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
        <div>
          <label htmlFor="signin-name" className="block text-sm font-medium text-slate-700">
            Display name
          </label>
          <input
            id="signin-name"
            type="text"
            value={displayNameInput}
            onChange={(e) => setDisplayNameInput(e.target.value)}
            placeholder="Finance Lead"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              void signIn('sandbox@onefpa.test', 'Sandbox User');
            }}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Sign in as sandbox user
          </button>
        </div>
      </form>
    </section>
  );
}
