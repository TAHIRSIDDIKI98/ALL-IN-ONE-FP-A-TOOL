// Ported from fpa/src-tauri/src/core/error.rs @ 6f6f72f5b681 and FPA-modular/app/core/errors.py @ 641d3d830573. Class B.
// Changes: Replaced desktop-only PIN/Ed25519 license/local-backup errors with cloud session/tenancy/AI-egress error codes per MASTER_PROMPT §1.7, §3.5, §9.8, §10.2, §10.3; validated via shared zod ErrorEnvelopeSchema with zero `any`. Oracle: shared/errors.test.ts.

import { z } from 'zod';

export const ERROR_CODES = [
  'SESSION_REQUIRED',
  'TOKEN_INVALID',
  'TENANT_FORBIDDEN',
  'RATE_LIMITED',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'DUPLICATE_CODE',
  'CALENDAR_CONFLICT',
  'PERIOD_NOT_FOUND',
  'IMPORT_FILE_UNSUPPORTED',
  'IMPORT_FILE_TOO_LARGE',
  'IMPORT_FILE_UNREADABLE',
  'IMPORT_TIE_OUT_FAILED',
  'MAP_ACCOUNT_AMBIGUOUS',
  'MAP_TARGET_INVALID',
  'COA_DUPLICATE_CODE',
  'COA_TYPE_MISMATCH',
  'TRIAL_BALANCE_IMBALANCE',
  'STATEMENT_TIE_OUT_FAILED',
  'ALLOCATION_ZERO_WEIGHTS',
  'MODEL_VERSION_LOCKED',
  'PERIOD_LOCKED',
  'DRILL_INVARIANT_FAILED',
  'AUDIT_CHAIN_BREAK',
  'LLM_EGRESS_BLOCKED',
  'AI_UNCITED_NUMERAL',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type JsonScalar = string | number | boolean | null;
export type ErrorDetails = Record<string, JsonScalar | JsonScalar[]>;

export interface ErrorSpec {
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly defaultUserMessage: string;
  readonly hint: string;
}

export const ERROR_CATALOG: Record<ErrorCode, ErrorSpec> = {
  SESSION_REQUIRED: {
    httpStatus: 401,
    retryable: false,
    defaultUserMessage: 'Sign-in is required to access this workspace.',
    hint: 'Sign in with your Google account and retry.',
  },
  TOKEN_INVALID: {
    httpStatus: 401,
    retryable: false,
    defaultUserMessage: 'Your session token is expired or invalid.',
    hint: 'Sign in again to refresh your session.',
  },
  TENANT_FORBIDDEN: {
    httpStatus: 403,
    retryable: false,
    defaultUserMessage: 'You do not have access to the requested company.',
    hint: 'Select an authorized company workspace.',
  },
  RATE_LIMITED: {
    httpStatus: 429,
    retryable: true,
    defaultUserMessage: 'Too many requests in a short window.',
    hint: 'Wait briefly and retry the action.',
  },
  VALIDATION_FAILED: {
    httpStatus: 422,
    retryable: false,
    defaultUserMessage: 'One or more request fields failed validation.',
    hint: 'Review the highlighted fields and submit again.',
  },
  NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    defaultUserMessage: 'The requested record could not be found.',
    hint: 'Refresh the view and choose an existing item.',
  },
  DUPLICATE_CODE: {
    httpStatus: 409,
    retryable: false,
    defaultUserMessage: 'That code is already in use in this company.',
    hint: 'Choose a unique code (leading zeros are preserved).',
  },
  CALENDAR_CONFLICT: {
    httpStatus: 422,
    retryable: false,
    defaultUserMessage: 'Fiscal calendar configuration has a 53-week or anchor conflict.',
    hint: 'Select a valid week anchor and Week-53 rule.',
  },
  PERIOD_NOT_FOUND: {
    httpStatus: 422,
    retryable: false,
    defaultUserMessage: 'Posting date does not belong to an open fiscal period.',
    hint: 'Verify the company fiscal calendar covers all import dates.',
  },
  IMPORT_FILE_UNSUPPORTED: {
    httpStatus: 415,
    retryable: false,
    defaultUserMessage: 'Unsupported import file format.',
    hint: 'Upload a CSV or Excel (.xlsx) export.',
  },
  IMPORT_FILE_TOO_LARGE: {
    httpStatus: 413,
    retryable: false,
    defaultUserMessage: 'Import file exceeds the size limit.',
    hint: 'Split the export by fiscal period and import each batch.',
  },
  IMPORT_FILE_UNREADABLE: {
    httpStatus: 422,
    retryable: false,
    defaultUserMessage: 'Import file could not be parsed cleanly.',
    hint: 'Check file encoding (UTF-8) and delimiter formatting.',
  },
  IMPORT_TIE_OUT_FAILED: {
    httpStatus: 422,
    retryable: false,
    defaultUserMessage: 'Journal debits and credits do not balance to the cent.',
    hint: 'Inspect unbalanced journal entries before committing.',
  },
  MAP_ACCOUNT_AMBIGUOUS: {
    httpStatus: 409,
    retryable: false,
    defaultUserMessage: 'Source account code maps to multiple target accounts.',
    hint: 'Resolve the mapping conflict in the CoA Mapper.',
  },
  MAP_TARGET_INVALID: {
    httpStatus: 422,
    retryable: false,
    defaultUserMessage: 'Selected target account is inactive or non-postable.',
    hint: 'Map to an active postable leaf account.',
  },
  COA_DUPLICATE_CODE: {
    httpStatus: 409,
    retryable: false,
    defaultUserMessage: 'Account code already exists with a conflicting account type.',
    hint: 'Use a distinct account code or align the account type.',
  },
  COA_TYPE_MISMATCH: {
    httpStatus: 422,
    retryable: false,
    defaultUserMessage: 'Account type and normal balance side are incoherent.',
    hint: 'Assets/expenses use debit normal side; liabilities/equity/revenue use credit (unless contra).',
  },
  TRIAL_BALANCE_IMBALANCE: {
    httpStatus: 422,
    retryable: false,
    defaultUserMessage: 'Trial Balance total debits do not equal total credits.',
    hint: 'Review journal entries in the period to locate the imbalance.',
  },
  STATEMENT_TIE_OUT_FAILED: {
    httpStatus: 422,
    retryable: false,
    defaultUserMessage: 'Financial statement articulation invariant failed.',
    hint: 'Inspect the articulation disclosure footer for the exact delta.',
  },
  ALLOCATION_ZERO_WEIGHTS: {
    httpStatus: 422,
    retryable: false,
    defaultUserMessage: 'Cannot allocate across buckets whose weights all equal zero.',
    hint: 'Provide at least one positive allocation weight.',
  },
  MODEL_VERSION_LOCKED: {
    httpStatus: 409,
    retryable: false,
    defaultUserMessage: 'This plan version is locked and immutable.',
    hint: 'Create a new draft plan version to edit budget lines.',
  },
  PERIOD_LOCKED: {
    httpStatus: 409,
    retryable: false,
    defaultUserMessage: 'This fiscal period is hard-closed and blocks new writes.',
    hint: 'Request an audited owner unlock or post to an open period.',
  },
  DRILL_INVARIANT_FAILED: {
    httpStatus: 500,
    retryable: false,
    defaultUserMessage: 'Drill-to-source rows did not sum exactly to the displayed figure.',
    hint: 'Report error code DRILL_INVARIANT_FAILED with the batch ID.',
  },
  AUDIT_CHAIN_BREAK: {
    httpStatus: 500,
    retryable: false,
    defaultUserMessage: 'Audit log hash-chain verification detected tampering or corruption.',
    hint: 'Escalate immediately to the workspace owner.',
  },
  LLM_EGRESS_BLOCKED: {
    httpStatus: 503,
    retryable: false,
    defaultUserMessage: 'AI egress is disabled or blocked by policy; deterministic narrative used.',
    hint: 'All financial calculations and deterministic reports remain available.',
  },
  AI_UNCITED_NUMERAL: {
    httpStatus: 422,
    retryable: true,
    defaultUserMessage: 'AI draft contained an uncited number and was rejected.',
    hint: 'Deterministic engine-backed narrative has been substituted.',
  },
  INTERNAL_ERROR: {
    httpStatus: 500,
    retryable: true,
    defaultUserMessage: 'An unexpected server error occurred. Your committed data is unchanged.',
    hint: 'Retry the failed action.',
  },
};

export const ErrorBodySchema = z.object({
  code: z.enum(ERROR_CODES),
  userMessage: z.string().min(1),
  hint: z.string().min(1),
  httpStatus: z.number().int().min(400).max(599),
  retryable: z.boolean(),
  retryAfterMs: z.number().int().nonnegative().optional(),
  details: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
      ]),
    )
    .default({}),
});

export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly userMessage: string;
  public readonly hint: string;
  public readonly httpStatus: number;
  public readonly retryable: boolean;
  public readonly retryAfterMs: number | undefined;
  public readonly details: ErrorDetails;

  constructor(
    code: ErrorCode,
    options?: {
      userMessage?: string;
      hint?: string;
      retryAfterMs?: number;
      details?: ErrorDetails;
    },
  ) {
    const spec = ERROR_CATALOG[code];
    const userMessage = options?.userMessage ?? spec.defaultUserMessage;
    super(`[${code}] ${userMessage}`);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.hint = options?.hint ?? spec.hint;
    this.httpStatus = spec.httpStatus;
    this.retryable = spec.retryable;
    this.retryAfterMs = options?.retryAfterMs;
    this.details = options?.details ?? {};
  }

  public toBody(): ErrorBody {
    const detailsCopy: Record<string, JsonScalar | JsonScalar[]> = {};
    for (const [k, v] of Object.entries(this.details)) {
      detailsCopy[k] = Array.isArray(v) ? [...v] : v;
    }
    return {
      code: this.code,
      userMessage: this.userMessage,
      hint: this.hint,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      ...(this.retryAfterMs !== undefined ? { retryAfterMs: this.retryAfterMs } : {}),
      details: detailsCopy,
    };
  }
}
