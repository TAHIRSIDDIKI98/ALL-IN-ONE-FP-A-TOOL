import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SPINE_ROUTE_DEFS } from '../shared/spine.js';
import { App } from './App.js';
import BoardPackPage from './pages/BoardPackPage.js';
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
});
