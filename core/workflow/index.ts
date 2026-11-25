/**
 * Pure Collaboration & Workflow Engine (MASTER_PROMPT §2.4, §11.9 COL1–COL3; SPEC §3.8).
 *
 * Strictly pure TypeScript with zero IO, zero framework imports, and zero `any`.
 * Owns:
 *  1. `approval_task` state machine transitions (`draft -> submitted -> approved | rejected`) + RBAC guard;
 *  2. Canonical comment anchor key construction (`version`, `account:<code>`, `cell:<code>:<period>`, `statement:<key>`);
 *  3. `@mention` extraction and deterministic company-member resolution.
 */

export type ApprovalStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type MembershipRole = 'owner' | 'editor' | 'reviewer' | 'viewer';

export type WorkflowTransitionErrorCode =
  | 'TENANT_FORBIDDEN'
  | 'MODEL_VERSION_LOCKED'
  | 'VALIDATION_FAILED';

export interface ApprovalTransitionInput {
  readonly currentStatus: ApprovalStatus;
  readonly nextStatus: ApprovalStatus;
  readonly actorRole: MembershipRole;
  readonly actorId: string;
  readonly reason?: string | null;
  readonly occurredAt: string;
}

export type ApprovalTransitionOutcome =
  | {
      readonly ok: true;
      readonly nextStatus: ApprovalStatus;
      readonly decisionReason: string | null;
      readonly lockPlanVersion: boolean;
      readonly eventKind: 'approval.submitted' | 'approval.approved' | 'approval.rejected';
      readonly stampSubmitted: { readonly by: string; readonly at: string } | null;
      readonly stampDecided: { readonly by: string; readonly at: string } | null;
    }
  | {
      readonly ok: false;
      readonly errorCode: WorkflowTransitionErrorCode;
      readonly reason: string;
    };

export function canActorCreateTask(role: MembershipRole): boolean {
  return role === 'owner' || role === 'editor';
}

export function canActorComment(role: MembershipRole): boolean {
  return role === 'owner' || role === 'editor' || role === 'reviewer';
}

export function canActorManageMembers(role: MembershipRole): boolean {
  return role === 'owner';
}

export function canActorTransitionTask(
  role: MembershipRole,
  nextStatus: ApprovalStatus,
): boolean {
  if (nextStatus === 'submitted') {
    return role === 'owner' || role === 'editor';
  }
  if (nextStatus === 'approved' || nextStatus === 'rejected') {
    return role === 'owner' || role === 'reviewer';
  }
  return false;
}

export function transitionApprovalTask(
  input: ApprovalTransitionInput,
): ApprovalTransitionOutcome {
  const { currentStatus, nextStatus, actorRole, actorId, occurredAt } = input;
  const trimmedReason = input.reason === undefined || input.reason === null ? '' : input.reason.trim();

  if (currentStatus === 'approved') {
    return {
      ok: false,
      errorCode: 'MODEL_VERSION_LOCKED',
      reason: `LOCKED_WORKFLOW_TASK: Approval task is already approved and locked; create a new plan version to revise.`,
    };
  }

  if (currentStatus === 'rejected') {
    return {
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: `INVALID_TRANSITION: Rejected task cannot transition to "${nextStatus}"; commit a new plan version to resubmit.`,
    };
  }

  if (!canActorTransitionTask(actorRole, nextStatus)) {
    return {
      ok: false,
      errorCode: 'TENANT_FORBIDDEN',
      reason: `ROLE_FORBIDDEN: Role "${actorRole}" is not permitted to transition an approval task to "${nextStatus}".`,
    };
  }

  if (currentStatus === 'draft') {
    if (nextStatus !== 'submitted') {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: `INVALID_TRANSITION: A draft task must be submitted before it can become "${nextStatus}".`,
      };
    }
    return {
      ok: true,
      nextStatus: 'submitted',
      decisionReason: trimmedReason.length > 0 ? trimmedReason : null,
      lockPlanVersion: false,
      eventKind: 'approval.submitted',
      stampSubmitted: { by: actorId, at: occurredAt },
      stampDecided: null,
    };
  }

  // currentStatus === 'submitted'
  if (nextStatus === 'approved') {
    return {
      ok: true,
      nextStatus: 'approved',
      decisionReason: trimmedReason.length > 0 ? trimmedReason : null,
      lockPlanVersion: true,
      eventKind: 'approval.approved',
      stampSubmitted: null,
      stampDecided: { by: actorId, at: occurredAt },
    };
  }

  if (nextStatus === 'rejected') {
    if (trimmedReason.length === 0) {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: 'REJECTION_REASON_REQUIRED: Rejecting a submitted plan requires a non-empty reason.',
      };
    }
    return {
      ok: true,
      nextStatus: 'rejected',
      decisionReason: trimmedReason,
      lockPlanVersion: false,
      eventKind: 'approval.rejected',
      stampSubmitted: null,
      stampDecided: { by: actorId, at: occurredAt },
    };
  }

  return {
    ok: false,
    errorCode: 'VALIDATION_FAILED',
    reason: `INVALID_TRANSITION: A submitted task cannot transition to "${nextStatus}".`,
  };
}

export type CommentAnchorKind = 'version' | 'account' | 'cell' | 'statement_line';

export type CommentAnchorInput =
  | { readonly kind: 'version' }
  | { readonly kind: 'account'; readonly accountCode: string }
  | { readonly kind: 'cell'; readonly accountCode: string; readonly periodCode: string }
  | { readonly kind: 'statement_line'; readonly statementLineKey: string };

export interface CanonicalCommentAnchor {
  readonly anchorKind: CommentAnchorKind;
  readonly anchorKey: string;
  readonly accountCode: string | null;
  readonly periodCode: string | null;
  readonly statementLineKey: string | null;
}

function normalizeCodePreserveZeros(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function buildCommentAnchorKey(
  input: CommentAnchorInput,
): { readonly ok: true; readonly anchor: CanonicalCommentAnchor } | { readonly ok: false; readonly reason: string } {
  if (input.kind === 'version') {
    return {
      ok: true,
      anchor: {
        anchorKind: 'version',
        anchorKey: 'version',
        accountCode: null,
        periodCode: null,
        statementLineKey: null,
      },
    };
  }

  if (input.kind === 'account') {
    const code = normalizeCodePreserveZeros(input.accountCode);
    if (code.length === 0 || code.includes(':')) {
      return { ok: false, reason: 'INVALID_ANCHOR: Account anchor requires a valid account code.' };
    }
    return {
      ok: true,
      anchor: {
        anchorKind: 'account',
        anchorKey: `account:${code}`,
        accountCode: code,
        periodCode: null,
        statementLineKey: null,
      },
    };
  }

  if (input.kind === 'cell') {
    const code = normalizeCodePreserveZeros(input.accountCode);
    const period = normalizeCodePreserveZeros(input.periodCode).toUpperCase();
    if (code.length === 0 || code.includes(':')) {
      return { ok: false, reason: 'INVALID_ANCHOR: Cell anchor requires a valid account code.' };
    }
    if (!/^P\d{2}$/.test(period)) {
      return {
        ok: false,
        reason: `INVALID_ANCHOR: Cell period "${input.periodCode}" must be canonical Pnn (e.g. P01).`,
      };
    }
    return {
      ok: true,
      anchor: {
        anchorKind: 'cell',
        anchorKey: `cell:${code}:${period}`,
        accountCode: code,
        periodCode: period,
        statementLineKey: null,
      },
    };
  }

  const lineKey = normalizeCodePreserveZeros(input.statementLineKey);
  if (lineKey.length === 0 || !/^[a-z]+\.[a-z0-9_.]+$/.test(lineKey)) {
    return {
      ok: false,
      reason: `INVALID_ANCHOR: Statement line key "${input.statementLineKey}" is invalid.`,
    };
  }
  return {
    ok: true,
    anchor: {
      anchorKind: 'statement_line',
      anchorKey: `statement:${lineKey}`,
      accountCode: null,
      periodCode: null,
      statementLineKey: lineKey,
    },
  };
}

export interface MentionableMember {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
}

/**
 * Extracts unique `@mention` handles starting at beginning-of-string or whitespace/punctuation,
 * so regular email addresses inside prose (`billing@vendor.com`) are not treated as mentions.
 */
export function extractMentionTokens(body: string): readonly string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  const re = /(?:^|[\s(\[,])@([a-zA-Z0-9._+-]+(?:@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const token = match[1]?.toLowerCase() ?? '';
    if (token.length > 0 && !seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}

export function resolveMentions(
  tokens: readonly string[],
  members: readonly MentionableMember[],
):
  | { readonly ok: true; readonly recipients: readonly MentionableMember[] }
  | { readonly ok: false; readonly issues: readonly string[] } {
  const issues: string[] = [];
  const resolved: MentionableMember[] = [];
  const seenIds = new Set<string>();

  for (const token of tokens) {
    const normalized = token.trim().toLowerCase();
    const exactEmail = members.filter((m) => m.email.toLowerCase() === normalized);
    let matches = exactEmail;
    if (matches.length === 0 && !normalized.includes('@')) {
      matches = members.filter((m) => (m.email.split('@')[0] ?? '').toLowerCase() === normalized);
    }

    if (matches.length === 0) {
      issues.push(`UNKNOWN_MENTION:@${token}`);
      continue;
    }
    if (matches.length > 1) {
      issues.push(`AMBIGUOUS_MENTION:@${token}`);
      continue;
    }
    const member = matches[0]!;
    if (!seenIds.has(member.userId)) {
      seenIds.add(member.userId);
      resolved.push(member);
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, recipients: resolved };
}
