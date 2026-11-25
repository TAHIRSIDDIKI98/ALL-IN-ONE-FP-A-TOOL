import { z } from 'zod';

/**
 * Canonical fiscal-calendar kind vocabulary (§5.8). Defined ONCE here and re-exported by
 * `shared/index.ts` — the preview contract, setup contract, and client share this single
 * definition (K3).
 */
export const CalendarKindSchema = z.enum(['12month', '445', '454', '544', '52_53', '13x4']);
export type CalendarKind = z.infer<typeof CalendarKindSchema>;

/** Canonical statement-line vocabulary (§4.5) — the ONLY financial vocabulary shared by wire contracts. */
export const StatementLineKeySchema = z.enum([
  'pl.revenue.product',
  'pl.revenue.service',
  'pl.revenue.other',
  'pl.cogs.direct',
  'pl.cogs.other',
  'pl.opex.payroll',
  'pl.opex.ga',
  'pl.opex.sm',
  'pl.opex.rd',
  'pl.opex.other',
  'pl.da.depreciation',
  'pl.da.amortization',
  'pl.nonop.interest_income',
  'pl.nonop.interest_expense',
  'pl.nonop.other',
  'pl.tax.income_tax',
  'bs.asset.cash',
  'bs.asset.ar',
  'bs.asset.inventory',
  'bs.asset.other_current',
  'bs.asset.ppe_gross',
  'bs.asset.ppe_accum_depr',
  'bs.asset.other_noncurrent',
  'bs.liability.ap',
  'bs.liability.accrued',
  'bs.liability.deferred_rev',
  'bs.liability.short_term_debt',
  'bs.liability.long_term_debt',
  'bs.liability.other_noncurrent',
  'bs.equity.common_stock',
  'bs.equity.retained_earnings',
  'bs.equity.distributions',
  'bs.equity.current_net_income',
  'cf.operating.net_income',
  'cf.operating.da_addback',
  'cf.operating.delta_wc',
  'cf.investing.capex',
  'cf.financing.debt',
  'cf.financing.equity',
  'cf.financing.distributions',
]);
export type StatementLineKey = z.infer<typeof StatementLineKeySchema>;

export const SPINE_ROUTE_DEFS = [
  { id: 'sign_in', path: '/sign-in', label: 'Sign In', screen: 'SignInPage' },
  { id: 'setup', path: '/setup', label: 'Setup Wizard', screen: 'SetupWizardPage' },
  { id: 'import', path: '/import', label: 'Import Wizard', screen: 'ImportWizardPage' },
  { id: 'coa_mapper', path: '/coa-mapper', label: 'CoA Mapper', screen: 'CoaMapperPage' },
  { id: 'model_grid', path: '/model-grid', label: 'Model Grid', screen: 'ModelGridPage' },
  { id: 'statements', path: '/statements', label: 'Statements', screen: 'StatementsPage' },
  { id: 'board_pack', path: '/board-pack', label: 'Board Pack', screen: 'BoardPackPage' },
] as const;

export type SpineRouteId = (typeof SPINE_ROUTE_DEFS)[number]['id'];
export type SpineRoutePath = (typeof SPINE_ROUTE_DEFS)[number]['path'];
export type ScreenUiState = 'loading' | 'empty' | 'error' | 'partial' | 'populated';

export const CalendarPreviewRequestSchema = z.object({
  kind: CalendarKindSchema,
  startYear: z.number().int().min(2000).max(2100),
  yearCount: z.number().int().min(1).max(5).default(1),
  startMonth: z.number().int().min(1).max(12).optional(),
  week53Rule: z.enum(['nrf4day', 'fullweek']).optional(),
  includeAdjustmentPeriod: z.boolean().optional(),
});

export type CalendarPreviewRequest = z.infer<typeof CalendarPreviewRequestSchema>;

export const ImportPreviewRequestSchema = z.object({
  csvText: z.string().min(1),
  locale: z.enum(['unknown', 'us', 'eu']).default('unknown'),
  knownAccountCodes: z.array(z.string().min(1)).default([]),
});

export type ImportPreviewRequest = z.infer<typeof ImportPreviewRequestSchema>;

/**
 * Sandbox-only session contract (§3.1 verifiability doctrine): the dev token endpoint exists
 * only when the server runs a non-production sandbox verifier. It is never mounted in
 * production and issues a real expiring, HMAC-signed token — not a bypass.
 */
export const SandboxTokenRequestSchema = z.object({
  email: z.string().trim().email().max(200),
  displayName: z.string().trim().min(1).max(120).default('Sandbox User'),
  ttlSeconds: z.number().int().min(60).max(86_400).default(3600),
});

export type SandboxTokenRequest = z.infer<typeof SandboxTokenRequestSchema>;

export const SandboxTokenResponseSchema = z.object({
  token: z.string().min(1),
  tokenType: z.literal('sandbox-hmac'),
  expiresInSeconds: z.number().int().positive(),
});

export type SandboxTokenResponse = z.infer<typeof SandboxTokenResponseSchema>;
