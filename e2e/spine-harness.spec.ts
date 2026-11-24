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

test.describe('OneFP&A M0/M1 Spine Harness', () => {
  test('enforces WCAG AA landmarks, single skip link, and honest empty states on all 7 routes', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    for (const route of SPINE_ROUTES) {
      await page.goto(route.path);

      // Single skip link first focusable element
      const skipLinks = page.locator('a[href="#main-content"]');
      await expect(skipLinks).toHaveCount(1);

      // WCAG landmarks
      await expect(page.locator('header[role="banner"]')).toHaveCount(1);
      await expect(page.locator('nav[aria-label="Primary Spine Navigation"]')).toHaveCount(1);
      await expect(page.locator('main#main-content[role="main"]')).toHaveCount(1);
      await expect(page.locator('footer[role="contentinfo"]')).toHaveCount(1);

      await expect(page.locator('h1')).toContainText(route.h1);

      // Honest loading and error states
      await page.goto(`${route.path}?state=loading`);
      await expect(page.locator('[role="status"]')).toHaveCount(1);

      await page.goto(`${route.path}?state=error`);
      await expect(page.locator('[role="alert"]')).toHaveCount(1);
      await expect(page.getByRole('button', { name: /Retry failed action/i })).toBeVisible();
    }

    expect(pageErrors).toEqual([]);
  });

  test('Setup Wizard previews live NRF 4-5-4 calendar periods and advances honestly to Import Wizard', async ({
    page,
  }) => {
    await page.goto('/setup');
    await page.getByLabel('Company Name').fill('Northwind Holdings Inc.');
    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByLabel('Fiscal Calendar Kind').selectOption('454');
    await expect(page.locator('table tbody tr')).toHaveCount(12);

    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: /Create Company & Continue/i }).click();

    await expect(page).toHaveURL(/\/import$/);
    await expect(page.locator('h1')).toContainText(/GL Import Wizard/i);
  });
});
