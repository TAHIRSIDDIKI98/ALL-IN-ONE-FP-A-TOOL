import type { ReactElement } from 'react';

export function App(): ReactElement {
  return (
    <div className="min-h-screen flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-slate-900 focus:text-white focus:px-4 focus:py-2 focus:rounded"
      >
        Skip to main content
      </a>
      <header role="banner" className="border-b border-slate-200 bg-white px-6 py-4">
        <span className="font-semibold tracking-tight text-slate-900">OneFP&amp;A</span>
      </header>
      <main id="main-content" role="main" className="flex-1 p-6">
        <h1 className="text-xl font-semibold text-slate-900">Sign in to OneFP&amp;A</h1>
        <p className="mt-2 text-sm text-slate-600">
          Authentication feed required: connect session to load company workspace.
        </p>
      </main>
      <footer role="contentinfo" className="border-t border-slate-200 bg-white px-6 py-3 text-xs text-slate-500">
        OneFP&amp;A · M0 Foundation
      </footer>
    </div>
  );
}
