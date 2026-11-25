import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';

const SPINE_ROUTES = [
  { path: '/sign-in', h1: /Sign in to OneFP&A/i },
  { path: '/setup', h1: /Company Setup Wizard/i },
  { path: '/import', h1: /GL Import Wizard/i },
  { path: '/coa-mapper', h1: /Chart of Accounts Mapper/i },
  { path: '/model-grid', h1: /Model Grid/i },
  { path: '/statements', h1: /Financial Statements/i },
  { path: '/board-pack', h1: /Board Pack Export/i },
] as const;

/**
 * Every attempt gets its own identity. Attempts share one in-memory database, so a fixed email
 * would leave a company behind and the retry would land on `/import` where the first attempt
 * correctly saw the setup wizard — a "failure" the product never had.
 */
const ownerForAttempt = (prefix: string, retry: number): string => `${prefix}-r${retry}@onefpa.test`;

async function signIn(page: Page, email: string, name: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Workspace email').fill(email);
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/sign-in$/, { timeout: 20_000 });
}

/** Drives the real 4-step setup wizard; the company is created by `POST /api/setup/company`. */
async function createCompanyThroughWizard(page: Page, companyName: string): Promise<void> {
  await expect(page.locator('h1')).toContainText(/Company Setup Wizard/i);
  await page.getByLabel('Company Name').fill(companyName);
  await expect(page.getByLabel('Company Name')).toHaveValue(companyName);
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByLabel('Fiscal Calendar Kind').selectOption('454');
  await expect(page.locator('table tbody tr')).toHaveCount(12);

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Create Company & Continue/i }).click();

  await expect(page).toHaveURL(/\/import$/);
  await expect(page.locator('h1')).toContainText(/GL Import Wizard/i);
}

test.describe('OneFP&A M1 Spine Harness', () => {
  test('enforces WCAG AA landmarks, single skip link, and honest loading/error states on all 7 routes', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    for (const route of SPINE_ROUTES) {
      await page.goto(route.path);

      const skipLinks = page.locator('a[href="#main-content"]');
      await expect(skipLinks).toHaveCount(1);
      await expect(skipLinks.first()).toHaveAttribute('href', '#main-content');

      await expect(page.locator('header[role="banner"]')).toHaveCount(1);
      await expect(page.locator('nav[aria-label="Primary Spine Navigation"]')).toHaveCount(1);
      await expect(page.locator('main#main-content[role="main"]')).toHaveCount(1);
      await expect(page.locator('footer[role="contentinfo"]')).toHaveCount(1);

      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toContainText(route.h1);

      await page.goto(`${route.path}?state=loading`);
      await expect(page.locator('[role="status"]')).toHaveCount(1);

      await page.goto(`${route.path}?state=error`);
      await expect(page.locator('[role="alert"]')).toHaveCount(1);
      await expect(page.getByRole('button', { name: /Retry failed action/i })).toBeVisible();
    }

    expect(pageErrors).toEqual([]);
  });

  /**
   * M2 planning is a VIEW inside the Model Grid, not an eighth screen (§9.1): the tab swaps the
   * panel, the single `h1` stays, and an unauthenticated visitor is told to sign in rather than shown
   * a fabricated forecast.
   */
  test('keeps planning inside the Model Grid with one h1 and an honest planning empty state', async ({
    page,
  }) => {
    await page.goto('/model-grid');
    await expect(page.locator('h1')).toContainText(/Model Grid/i);

    const planningTab = page.getByRole('tab', { name: 'Planning' });
    await planningTab.click();
    await expect(planningTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page).toHaveURL(/\/model-grid$/);

    await expect(page.getByRole('tabpanel', { name: 'Planning view' })).toContainText(
      /Sign in and create a company workspace before reading planning scenarios/,
    );
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  /**
   * Sandbox sign-in mints a server token, the setup wizard creates the company server-side, and a
   * RELOAD plus second sign-in proves the server kept it: the app now routes straight to the Import
   * Wizard instead of asking for setup again.
   */
  test('signs in against the API and creates a company the server persists', async ({ page }) => {
    const owner = ownerForAttempt('e2e-owner', test.info().retry);

    await signIn(page, owner, 'E2E Owner');

    // A brand-new identity has no company, so the app routes it to the setup wizard.
    await expect(page.locator('h1')).toContainText(/Company Setup Wizard/i);
    expect(new URL(page.url()).pathname).toBe('/setup');

    await createCompanyThroughWizard(page, 'Northwind Holdings Inc.');

    // Fresh page load = fresh browser session: signing in again must find the company server-side.
    await signIn(page, owner, 'E2E Owner');
    await expect(page).toHaveURL(/\/import$/, { timeout: 20_000 });
    await expect(page.locator('h1')).toContainText(/GL Import Wizard/i);
    expect(new URL(page.url()).pathname).toBe('/import');
  });

  test('statements screen renders the server figures for a persisted company', async ({ page }) => {
    const owner = ownerForAttempt('e2e-statements', test.info().retry);

    await signIn(page, owner, 'E2E Owner');
    await createCompanyThroughWizard(page, 'Cascade Analytics Inc.');

    // The API token is memory-only by design (§3.2): a hard page load re-authenticates, so the spine
    // is navigated in-app through the primary nav exactly as a user would.
    await page
      .getByRole('navigation', { name: 'Primary Spine Navigation' })
      .getByRole('link', { name: 'Statements' })
      .click();
    await expect(page).toHaveURL(/\/statements$/);
    await expect(page.locator('h1')).toContainText(/Financial Statements/i);
    await expect(page.getByRole('tablist', { name: 'Statement Views' })).toBeVisible();

    // The company exists but has no postings yet: the server reports zero, and the screen must show
    // that zero rather than inventing or hiding it. Total assets is a balance-sheet line and the
    // screen opens on the P&L tab, so the balance sheet has to be selected first.
    const balanceSheetTab = page.getByRole('tab', { name: 'Balance Sheet' });
    await balanceSheetTab.click();
    await expect(balanceSheetTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('row', { name: /Total assets/i })).toContainText('0.00');
    await expect(page.getByText('A1 pass')).toBeVisible();
    await expect(page.getByText(/0 committed source file/)).toBeVisible();
  });
});
