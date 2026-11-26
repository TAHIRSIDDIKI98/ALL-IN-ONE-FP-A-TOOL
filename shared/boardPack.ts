import { z } from 'zod';
import { BvaReportSchema } from './bva.js';
import {
  ArticulationCheckSchema,
  StatementPeriodRangeSchema,
  TrialBalanceSourceSchema,
} from './reports.js';

/**
 * Board-pack wire contract (MASTER_PROMPT §5.6 A6, §9.3.7; Spine Gates G7/U5).
 *
 * There is ONE canonical pack model. The preview, XLSX, PDF, and PPTX renderers consume
 * the same `rows[]`; every `value` is a decimal string already produced by /core, never a number
 * formatted by the browser or recalculated by a renderer. The key namespaces below are declared
 * once here so UI, exports and tests cannot invent a second financial vocabulary (§4.5, K3).
 */

/** Display token for an absent plan/variance — never rendered as a zero (§5.2 null law). */
export const NOT_PLANNED = 'not planned';

export const BOARD_PACK_KEY_NAMESPACES = {
  statement: 'statement:',
  variance: 'bva:',
} as const;

export const BoardPackSectionSchema = z.enum(['cover', 'pl', 'bs', 'cf', 'bva']);
export type BoardPackSection = z.infer<typeof BoardPackSectionSchema>;

/** One printed line of the pack: key, presentation label, engine value and optional basis text. */
export const BoardPackRowSchema = z.object({
  section: BoardPackSectionSchema,
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.string(),
  detail: z.string().nullable(),
});
export type BoardPackRow = z.infer<typeof BoardPackRowSchema>;

export const BoardPackExportFormatSchema = z.enum(['xlsx', 'pdf', 'pptx']);
export type BoardPackExportFormat = z.infer<typeof BoardPackExportFormatSchema>;

export const BoardPackReportSchema = z.object({
  companyId: z.string().uuid(),
  companyName: z.string().min(1),
  baseCurrency: z.string().length(3),
  range: StatementPeriodRangeSchema,
  rows: z.array(BoardPackRowSchema),
  articulation: z.object({
    valid: z.boolean(),
    checks: z.array(ArticulationCheckSchema),
  }),
  sources: z.array(TrialBalanceSourceSchema),
  hasPlan: z.boolean(),
  basis: z.string(),
  disclosure: z.string(),
  /** Kept as a separate canonical read model so the pack carries the full BvA basis. */
  bva: BvaReportSchema,
});
export type BoardPackReport = z.infer<typeof BoardPackReportSchema>;
