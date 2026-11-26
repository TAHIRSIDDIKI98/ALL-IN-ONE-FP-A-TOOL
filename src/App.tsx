import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react';
import { isRtlLocale, translateMessage, type SupportedLocale } from '../shared/guidance.js';
import { SPINE_ROUTE_DEFS, type SpineRoutePath } from '../shared/spine.js';
import { HelpGuidanceDrawer } from './components/HelpGuidanceDrawer.js';
import { LoadingState } from './components/StateFrame.js';
import { useWorkspaceStore } from './state/workspaceStore.js';

const SignInPage = lazy(() => import('./pages/SignInPage.js'));
const SetupWizardPage = lazy(() => import('./pages/SetupWizardPage.js'));
const ImportWizardPage = lazy(() => import('./pages/ImportWizardPage.js'));
const CoaMapperPage = lazy(() => import('./pages/CoaMapperPage.js'));
const ModelGridPage = lazy(() => import('./pages/ModelGridPage.js'));
const StatementsPage = lazy(() => import('./pages/StatementsPage.js'));
const BoardPackPage = lazy(() => import('./pages/BoardPackPage.js'));

function resolveRoutePath(pathname: string): SpineRoutePath {
  const clean = pathname === '/' ? '/sign-in' : pathname.replace(/\/+$/, '');
  const matched = SPINE_ROUTE_DEFS.find((r) => r.path === clean);
  return matched ? matched.path : '/sign-in';
}

function resolveForcedState(search: string): 'loading' | 'empty' | 'error' | undefined {
  const s = new URLSearchParams(search).get('state');
  if (s === 'loading' || s === 'empty' || s === 'error') {
    return s;
  }
  return undefined;
}

export function App(props: {
  readonly initialPath?: string;
  readonly initialSearch?: string;
  readonly initialLocale?: SupportedLocale;
}): ReactElement {
  const [currentPath, setCurrentPath] = useState<SpineRoutePath>(() =>
    resolveRoutePath(
      props.initialPath ?? (typeof window !== 'undefined' ? window.location.pathname : '/sign-in'),
    ),
  );
  const [forcedState, setForcedState] = useState<'loading' | 'empty' | 'error' | undefined>(() =>
    resolveForcedState(
      props.initialSearch ?? (typeof window !== 'undefined' ? window.location.search : ''),
    ),
  );
  const [helpOpen, setHelpOpen] = useState<boolean>(false);

  const authToken = useWorkspaceStore((s) => s.authToken);
  const company = useWorkspaceStore((s) => s.company);
  const storeLocale = useWorkspaceStore((s) => s.displayLocale);
  const displayLocale = props.initialLocale ?? storeLocale;
  const displayTimeZone = useWorkspaceStore((s) => s.displayTimeZone);
  const setDisplayLocale = useWorkspaceStore((s) => s.setDisplayLocale);
  const setDisplayTimeZone = useWorkspaceStore((s) => s.setDisplayTimeZone);

  useEffect(() => {
    const onPopState = (): void => {
      setCurrentPath(resolveRoutePath(window.location.pathname));
      setForcedState(resolveForcedState(window.location.search));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (path: SpineRoutePath): void => {
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setCurrentPath(path);
    setForcedState(undefined);
  };

  const renderPage = (): ReactElement => {
    const commonProps = {
      onNavigate: navigate,
      ...(forcedState !== undefined ? { forcedState } : {}),
    };
    switch (currentPath) {
      case '/sign-in':
        return <SignInPage {...commonProps} />;
      case '/setup':
        return <SetupWizardPage {...commonProps} />;
      case '/import':
        return <ImportWizardPage {...commonProps} />;
      case '/coa-mapper':
        return <CoaMapperPage {...commonProps} />;
      case '/model-grid':
        return <ModelGridPage {...commonProps} />;
      case '/statements':
        return <StatementsPage {...commonProps} />;
      case '/board-pack':
        return <BoardPackPage {...commonProps} />;
    }
  };

  return (
    <div
      dir={isRtlLocale(displayLocale) ? 'rtl' : 'ltr'}
      data-locale={displayLocale}
      className="min-h-screen flex flex-col bg-slate-50 text-slate-900"
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-slate-900 focus:text-white focus:px-4 focus:py-2 focus:rounded"
      >
        Skip to main content
      </a>

      <header role="banner" className="border-b border-slate-200 bg-white px-6 py-4 flex items-center justify-between gap-4">
        <span className="font-semibold tracking-tight text-slate-900">OneFP&amp;A</span>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-slate-500">M2 Planning Suite Shell</span>
          <button
            type="button"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((prev) => !prev)}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
          >
            {translateMessage(displayLocale, 'help.drawer.openButton')}
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        <nav
          aria-label="Primary Spine Navigation"
          className="border-b md:border-b-0 md:border-e border-slate-200 bg-white px-4 py-4 md:w-56 md:shrink-0"
        >
          <ul className="flex flex-wrap gap-1 md:flex-col">
            {SPINE_ROUTE_DEFS.map((route) => {
              const active = currentPath === route.path;
              return (
                <li key={route.id}>
                  <a
                    href={route.path}
                    aria-current={active ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(route.path);
                    }}
                    className={`block rounded px-3 py-2 text-sm font-medium ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    {route.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <main id="main-content" role="main" tabIndex={-1} className="flex-1 min-w-0 p-6">
          <Suspense fallback={<LoadingState label="Loading workspace screen..." />}>
            {renderPage()}
          </Suspense>
        </main>

        <HelpGuidanceDrawer
          isOpen={helpOpen}
          onClose={() => setHelpOpen(false)}
          currentPath={currentPath}
          company={company}
          authToken={authToken}
          displayLocale={displayLocale}
          displayTimeZone={displayTimeZone}
          onChangeLocale={setDisplayLocale}
          onChangeTimeZone={setDisplayTimeZone}
          onNavigate={navigate}
        />
      </div>

      <footer role="contentinfo" className="border-t border-slate-200 bg-white px-6 py-3 text-xs text-slate-500">
        OneFP&amp;A · Exact 7-Screen Spine
      </footer>
    </div>
  );
}

