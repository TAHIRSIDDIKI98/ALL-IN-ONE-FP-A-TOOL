import { z } from 'zod';

/**
 * Canonical fiscal-calendar kind vocabulary (§5.8). Defined ONCE here and re-exported by
 * `shared/index.ts` — the preview contract, setup contract, and client share this single
 * definition (K3).
 */
export const CalendarKindSchema = z.enum(['12month', '445', '454', '544', '52_53', '13x4']);
export type CalendarKind = z.infer<typeof CalendarKindSchema>;

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
