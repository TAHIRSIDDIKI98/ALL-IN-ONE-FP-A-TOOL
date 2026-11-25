import { expect, test } from '@playwright/test';

const SPINE_ROUTES = [
  { path: '/sign-in', h1: /Sign in to OneFP&A/i },
  { path: '/setup', h1: /Company Setup Wizard/i },
  { path: '/import', h1: /GL Import Wizard/i },
  { path: '/coa-mapper', h1: /Chart of Accounts Mapper/i },
  { path: '/model-grid', h1: /Model Grid/i },
  { path: '/statements', h1: /Financial Statements/i },
  { path: '/board-pack', h1: /Board Pack Export/i },
] as const;

const OWNER_EMAIL = 'e2e-owner@onefpa.test';

async function signIn(page: import('@playwright/test').Page, email: string, name: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Workspace email').fill(email);
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.describe.configure({ mode: 'serial' });

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

      await expect(page.locator('header[role="banner"]')).toHaveCount(1);
      await expect(page.locator('nav[aria-label="Primary Spine Navigation"]')).toHaveCount(1);
      await expect(page.locator('main#main-content[role="main"]')).toHaveCount(1);
      await expect(page.locator('footer[role="contentinfo"]')).toHaveCount(1);

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
   * The spine against the real API: sandbox sign-in mints a server token, the setup wizard creates
   * the company server-side, and a RELOAD + sign-in proves the server kept it (the app now routes
   * straight to the Import Wizard instead of asking for setup again).
   */
  test('signs in against the API and creates a company the server persists', async ({ page }) => {
    await signIn(page, OWNER_EMAIL, 'E2E Owner');

    // A brand-new identity has no company, so the app routes it to the setup wizard.
    await expect(page.locator('h1')).toContainText(/Company Setup Wizard/i);
    expect(new URL(page.url()).pathname).toBe('/setup');

    await page.getByLabel('Company Name').fill('Northwind Holdings Inc.');
    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByLabel('Fiscal Calendar Kind').selectOption('454');
    await expect(page.locator('table tbody tr')).toHaveCount(12);

    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: /Create Company & Continue/i }).click();

    await expect(page).toHaveURL(/\/import$/);
    await expect(page.locator('h1')).toContainText(/GL Import Wizard/i);

    // Fresh page load = fresh in-memory session: signing in again must find the company server-side.
    await signIn(page, OWNER_EMAIL, 'E2E Owner');
    await expect(page).toHaveURL(/\/import$/, { timeout: 15_000 });
    await expect(page.locator('h1')).toContainText(/GL Import Wizard/i);
  });

  test('statements screen renders the server figures for the persisted company', async ({ page }) => {
    await signIn(page, OWNER_EMAIL, 'E2E Owner');
    await expect(page).toHaveURL(/\/import$/, { timeout: 15_000 });

    await page.goto('/statements');
    await expect(page.locator('h1')).toContainText(/Financial Statements/i);

    // The company exists but has no postings yet: the server reports zero, and the screen must show
    // that zero rather than inventing or hiding it. Total assets is a balance-sheet line and the
    // screen opens on the P&L tab, so the balance sheet has to be selected first.
    await page.getByRole('tab', { name: 'Balance Sheet' }).click();
    await expect(page.getByRole('row', { name: /Total assets/i })).toContainText('0.00');
    await expect(page.getByText('A1 pass')).toBeVisible();
    await expect(page.getByText(/0 committed source file/)).toBeVisible();
  });
});
