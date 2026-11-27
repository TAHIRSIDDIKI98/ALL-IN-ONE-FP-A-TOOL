/**
 * Pure Close Management & Period Lock Engine (MASTER_PROMPT §2.4, §12.6 CLS1–CLS4; SPEC §3.16).
 *
 * Strictly pure TypeScript with zero IO, zero framework imports, and zero `any`.
 * Owns:
 *  1. Close calendar task-template DAG validation & cycle detection (CLS1);
 *  2. Task transition & sign-off enforcement (prerequisites, reconciliation gate, RBAC, optimistic concurrency — CLS1/CLS2);
 *  3. Derived close status from task completion + reconciliation + period lock (never hand-set — CLS4);
 *  4. Soft-close / hard-close / audited unlock state machine & period write guard (CLS3).
 */

import { div, money, serialize } from '../money/index.js';

export type PeriodLockStatus = 'open' | 'soft_closed' | 'hard_closed';
export type CloseTaskCategory = 'import' | 'reconciliation' | 'review' | 'reporting' | 'lock';
export type CloseOwnerRole = 'owner' | 'editor' | 'reviewer';
export type CloseMembershipRole = 'owner' | 'editor' | 'reviewer' | 'viewer';
export type CloseTaskStatus = 'pending' | 'in_progress' | 'signed_off' | 'reopened';
export type CloseDerivedStatus =
  | 'not_started'
  | 'in_progress'
  | 'blocked_reconciliation'
  | 'ready_to_close'
  | 'soft_closed'
  | 'hard_closed';

export interface CloseTaskTemplateInput {
  readonly taskKey: string;
  readonly title: string;
  readonly category: CloseTaskCategory;
  readonly ownerRole: CloseOwnerRole;
  readonly dueDayOffset: number;
  readonly prerequisiteKeys: readonly string[];
  readonly requiresReconciliation: boolean;
  readonly sortOrder: number;
}

export interface CloseTaskSnapshot {
  readonly id: string;
  readonly taskKey: string;
  readonly title: string;
  readonly category: CloseTaskCategory;
  readonly ownerRole: CloseOwnerRole;
  readonly dueDate: string;
  readonly prerequisiteKeys: readonly string[];
  readonly requiresReconciliation: boolean;
  readonly status: CloseTaskStatus;
  readonly sortOrder: number;
  readonly signedOffBy: string | null;
  readonly signedOffAt: string | null;
  readonly signoffNote: string | null;
  readonly version: number;
}

export interface CloseReconciliationInput {
  readonly trialBalanceBalanced: boolean;
  readonly unmappedOrQuarantinedCount: number;
  readonly statementArticulationValid: boolean;
  readonly hasActualsInPeriod: boolean;
  readonly issues?: readonly string[];
}

export interface CloseReconciliationEvaluation {
  readonly passed: boolean;
  readonly issues: readonly string[];
}

export interface CloseTaskDagView extends CloseTaskSnapshot {
  readonly isUnlocked: boolean;
  readonly blockingPrerequisites: readonly string[];
  readonly blockingReasons: readonly string[];
}

export interface DerivedCloseStatusSummary {
  readonly derivedStatus: CloseDerivedStatus;
  readonly lockStatus: PeriodLockStatus;
  readonly totalTasks: number;
  readonly signedOffCount: number;
  readonly inProgressCount: number;
  readonly pendingCount: number;
  readonly reopenedCount: number;
  readonly completionPct: string;
  readonly reconciliationPassed: boolean;
  readonly readyForHardClose: boolean;
  readonly incompleteTaskKeys: readonly string[];
}

export type CloseDagValidationResult =
  | { readonly ok: true; readonly ordered: readonly CloseTaskTemplateInput[] }
  | {
      readonly ok: false;
      readonly errorCode: 'VALIDATION_FAILED';
      readonly reason: string;
      readonly details: Readonly<Record<string, string | readonly string[]>>;
    };

export type CloseTaskTransitionOutcome =
  | {
      readonly ok: true;
      readonly nextStatus: CloseTaskStatus;
      readonly signedOffBy: string | null;
      readonly signedOffAt: string | null;
      readonly signoffNote: string | null;
      readonly auditAction: 'close.task_started' | 'close.task_signed_off' | 'close.task_reopened';
    }
  | {
      readonly ok: false;
      readonly errorCode: 'VALIDATION_FAILED' | 'TENANT_FORBIDDEN' | 'MODEL_VERSION_LOCKED' | 'PERIOD_LOCKED';
      readonly reason: string;
    };

export type PeriodLockTransitionOutcome =
  | {
      readonly ok: true;
      readonly nextStatus: PeriodLockStatus;
      readonly auditAction: 'period.soft_closed' | 'period.hard_closed' | 'period.unlocked';
    }
  | {
      readonly ok: false;
      readonly errorCode: 'VALIDATION_FAILED' | 'TENANT_FORBIDDEN';
      readonly reason: string;
    };

export interface PeriodWriteTarget {
  readonly id: string;
  readonly code: string;
  readonly fiscalYear: number;
  readonly lockStatus: PeriodLockStatus;
}

export interface PeriodWriteAdvisory {
  readonly periodId: string;
  readonly periodCode: string;
  readonly fiscalYear: number;
  readonly lockStatus: 'soft_closed' | 'hard_closed';
  readonly code: 'SOFT_CLOSE_WRITE_WARNING' | 'HARD_CLOSE_WRITE_BLOCKED';
  readonly message: string;
}

export interface PeriodWriteGuardResult {
  readonly allowed: boolean;
  readonly blockedPeriods: readonly PeriodWriteAdvisory[];
  readonly warnings: readonly PeriodWriteAdvisory[];
}

const TASK_KEY_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pure UTC calendar arithmetic: adds `offsetDays` to an ISO `YYYY-MM-DD` date string.
 */
export function addUtcDaysToPeriodDate(isoDate: string, offsetDays: number): string {
  if (!ISO_DATE_RE.test(isoDate)) {
    throw new Error(`INVALID_PERIOD_DATE:${isoDate}`);
  }
  const [yStr = '1970', mStr = '01', dStr = '01'] = isoDate.split('-');
  const year = Number.parseInt(yStr, 10);
  const month = Number.parseInt(mStr, 10);
  const day = Number.parseInt(dStr, 10);
  const utc = new Date(Date.UTC(year, month - 1, day + offsetDays));
  const outYear = String(utc.getUTCFullYear()).padStart(4, '0');
  const outMonth = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const outDay = String(utc.getUTCDate()).padStart(2, '0');
  return `${outYear}-${outMonth}-${outDay}`;
}

/**
 * Validates close task templates and returns a deterministic Kahn topological ordering (CLS1).
 * Rejects duplicate keys, unknown prerequisite keys, self-dependencies, and dependency cycles.
 */
export function validateCloseTaskDag(
  templates: readonly CloseTaskTemplateInput[],
): CloseDagValidationResult {
  if (templates.length === 0) {
    return {
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: 'EMPTY_CLOSE_TEMPLATES: At least one close task template is required.',
      details: { reason: 'EMPTY_CLOSE_TEMPLATES' },
    };
  }

  const byKey = new Map<string, CloseTaskTemplateInput>();
  for (const item of templates) {
    const key = item.taskKey.trim();
    if (!TASK_KEY_RE.test(key)) {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: `INVALID_TASK_KEY:${item.taskKey}`,
        details: { taskKey: item.taskKey },
      };
    }
    if (item.title.trim().length === 0) {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: `EMPTY_TASK_TITLE:${key}`,
        details: { taskKey: key },
      };
    }
    if (!Number.isInteger(item.dueDayOffset) || item.dueDayOffset < -30 || item.dueDayOffset > 60) {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: `INVALID_DUE_OFFSET:${key}`,
        details: { taskKey: key },
      };
    }
    if (!Number.isInteger(item.sortOrder) || item.sortOrder < 0) {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: `INVALID_SORT_ORDER:${key}`,
        details: { taskKey: key },
      };
    }
    if (byKey.has(key)) {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: `DUPLICATE_TASK_KEY:${key}`,
        details: { taskKey: key },
      };
    }
    const normalizedPrereqs = [...new Set(item.prerequisiteKeys.map((p) => p.trim()).filter(Boolean))];
    byKey.set(key, {
      ...item,
      taskKey: key,
      title: item.title.trim(),
      prerequisiteKeys: normalizedPrereqs,
    });
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const key of byKey.keys()) {
    inDegree.set(key, 0);
    dependents.set(key, []);
  }

  for (const item of byKey.values()) {
    for (const prereq of item.prerequisiteKeys) {
      if (prereq === item.taskKey) {
        return {
          ok: false,
          errorCode: 'VALIDATION_FAILED',
          reason: `SELF_DEPENDENCY:${item.taskKey}`,
          details: { taskKey: item.taskKey },
        };
      }
      if (!byKey.has(prereq)) {
        return {
          ok: false,
          errorCode: 'VALIDATION_FAILED',
          reason: `UNKNOWN_PREREQUISITE_KEY:${item.taskKey}->${prereq}`,
          details: { taskKey: item.taskKey, prerequisiteKey: prereq },
        };
      }
      inDegree.set(item.taskKey, (inDegree.get(item.taskKey) ?? 0) + 1);
      dependents.get(prereq)?.push(item.taskKey);
    }
  }

  const compareTasks = (aKey: string, bKey: string): number => {
    const a = byKey.get(aKey)!;
    const b = byKey.get(bKey)!;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.taskKey.localeCompare(b.taskKey);
  };

  const ready: string[] = [...byKey.keys()]
    .filter((k) => (inDegree.get(k) ?? 0) === 0)
    .sort(compareTasks);
  const ordered: CloseTaskTemplateInput[] = [];

  while (ready.length > 0) {
    const current = ready.shift()!;
    ordered.push(byKey.get(current)!);
    for (const dep of dependents.get(current) ?? []) {
      const nextDeg = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, nextDeg);
      if (nextDeg === 0) {
        ready.push(dep);
        ready.sort(compareTasks);
      }
    }
  }

  if (ordered.length !== byKey.size) {
    const cyclicKeys = [...byKey.keys()]
      .filter((k) => (inDegree.get(k) ?? 0) > 0)
      .sort();
    return {
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: `CLOSE_DAG_CYCLE:${cyclicKeys.join(',')}`,
      details: { cyclicKeys },
    };
  }

  return { ok: true, ordered };
}

export function evaluateCloseReconciliation(
  input: CloseReconciliationInput,
): CloseReconciliationEvaluation {
  const issues: string[] = [];
  if (!input.trialBalanceBalanced) {
    issues.push('TRIAL_BALANCE_IMBALANCE: Trial balance debits do not equal credits for the close period.');
  }
  if (input.unmappedOrQuarantinedCount > 0) {
    issues.push(
      `QUARANTINED_IMPORT_ROWS: ${input.unmappedOrQuarantinedCount} quarantined import row(s) remain unresolved in this period.`,
    );
  }
  if (input.hasActualsInPeriod && !input.statementArticulationValid) {
    issues.push('STATEMENT_ARTICULATION_FAILED: Financial statements fail A1–A5 articulation for the close period.');
  }
  for (const extra of input.issues ?? []) {
    if (extra.trim().length > 0) issues.push(extra.trim());
  }
  return {
    passed: issues.length === 0,
    issues,
  };
}

export function computeCloseTaskDagState(
  tasks: readonly CloseTaskSnapshot[],
  reconciliation: CloseReconciliationEvaluation,
): readonly CloseTaskDagView[] {
  const statusByKey = new Map(tasks.map((t) => [t.taskKey, t.status]));
  return [...tasks]
    .sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.taskKey.localeCompare(b.taskKey)))
    .map((task) => {
      const blockingPrerequisites = task.prerequisiteKeys.filter(
        (key) => statusByKey.get(key) !== 'signed_off',
      );
      const blockingReasons: string[] = [];
      if (blockingPrerequisites.length > 0) {
        blockingReasons.push(`Waiting on prerequisites: ${blockingPrerequisites.join(', ')}`);
      }
      if (task.requiresReconciliation && !reconciliation.passed) {
        blockingReasons.push('Waiting on period reconciliation gate to pass');
      }
      return {
        ...task,
        isUnlocked: blockingReasons.length === 0,
        blockingPrerequisites,
        blockingReasons,
      };
    });
}

/**
 * Derives close status strictly from task completion + reconciliation + period lock (CLS4).
 * Never hand-set.
 */
export function derivePeriodCloseStatus(input: {
  readonly tasks: readonly CloseTaskSnapshot[];
  readonly lockStatus: PeriodLockStatus;
  readonly reconciliation: CloseReconciliationEvaluation;
}): DerivedCloseStatusSummary {
  const totalTasks = input.tasks.length;
  let signedOffCount = 0;
  let inProgressCount = 0;
  let pendingCount = 0;
  let reopenedCount = 0;
  const incompleteTaskKeys: string[] = [];

  for (const task of input.tasks) {
    if (task.status === 'signed_off') signedOffCount += 1;
    else {
      incompleteTaskKeys.push(task.taskKey);
      if (task.status === 'in_progress') inProgressCount += 1;
      else if (task.status === 'reopened') reopenedCount += 1;
      else pendingCount += 1;
    }
  }

  const completionPct =
    totalTasks === 0
      ? '0.00'
      : serialize(
          div(money(String(signedOffCount * 100)), money(String(totalTasks)), 2, 'HALF_UP') ??
            money('0'),
          2,
        );

  const readyForHardClose =
    totalTasks > 0 && signedOffCount === totalTasks && input.reconciliation.passed;

  let derivedStatus: CloseDerivedStatus;
  if (input.lockStatus === 'hard_closed') {
    derivedStatus = 'hard_closed';
  } else if (input.lockStatus === 'soft_closed') {
    derivedStatus = 'soft_closed';
  } else if (!input.reconciliation.passed) {
    derivedStatus = 'blocked_reconciliation';
  } else if (
    totalTasks === 0 ||
    (signedOffCount === 0 && inProgressCount === 0 && reopenedCount === 0)
  ) {
    derivedStatus = 'not_started';
  } else if (signedOffCount === totalTasks) {
    derivedStatus = 'ready_to_close';
  } else {
    derivedStatus = 'in_progress';
  }

  return {
    derivedStatus,
    lockStatus: input.lockStatus,
    totalTasks,
    signedOffCount,
    inProgressCount,
    pendingCount,
    reopenedCount,
    completionPct,
    reconciliationPassed: input.reconciliation.passed,
    readyForHardClose,
    incompleteTaskKeys,
  };
}

export function canActorMutateCloseTask(
  actorRole: CloseMembershipRole,
  taskOwnerRole: CloseOwnerRole,
): boolean {
  if (actorRole === 'owner') return true;
  if (actorRole === 'viewer') return false;
  return actorRole === taskOwnerRole;
}

export function evaluateCloseTaskTransition(input: {
  readonly tasks: readonly CloseTaskSnapshot[];
  readonly taskId: string;
  readonly action: 'start' | 'sign_off' | 'reopen';
  readonly actorRole: CloseMembershipRole;
  readonly actorId: string;
  readonly periodLockStatus: PeriodLockStatus;
  readonly reconciliation: CloseReconciliationEvaluation;
  readonly expectedVersion: number;
  readonly note?: string | null;
  readonly occurredAt: string;
}): CloseTaskTransitionOutcome {
  if (input.periodLockStatus === 'hard_closed') {
    return {
      ok: false,
      errorCode: 'PERIOD_LOCKED',
      reason: 'PERIOD_LOCKED: Period is hard-closed; explicitly unlock the period before mutating close tasks.',
    };
  }

  const target = input.tasks.find((t) => t.id === input.taskId);
  if (target === undefined) {
    return {
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: `CLOSE_TASK_NOT_FOUND:${input.taskId}`,
    };
  }

  if (target.version !== input.expectedVersion) {
    return {
      ok: false,
      errorCode: 'MODEL_VERSION_LOCKED',
      reason: `STALE_CLOSE_TASK_VERSION: expected ${input.expectedVersion}, actual ${target.version}.`,
    };
  }

  if (!canActorMutateCloseTask(input.actorRole, target.ownerRole)) {
    return {
      ok: false,
      errorCode: 'TENANT_FORBIDDEN',
      reason: `ROLE_FORBIDDEN: Role "${input.actorRole}" cannot transition close tasks owned by "${target.ownerRole}".`,
    };
  }

  const trimmedNote = input.note === undefined || input.note === null ? '' : input.note.trim();

  if (input.action === 'start') {
    if (target.status === 'signed_off') {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: 'INVALID_TASK_TRANSITION: Signed-off task must be reopened before restarting.',
      };
    }
    if (target.status === 'in_progress') {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: 'INVALID_TASK_TRANSITION: Close task is already in progress.',
      };
    }
    return {
      ok: true,
      nextStatus: 'in_progress',
      signedOffBy: null,
      signedOffAt: null,
      signoffNote: trimmedNote.length > 0 ? trimmedNote : target.signoffNote,
      auditAction: 'close.task_started',
    };
  }

  if (input.action === 'sign_off') {
    if (target.status === 'signed_off') {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: 'INVALID_TASK_TRANSITION: Close task is already signed off.',
      };
    }
    const statusByKey = new Map(input.tasks.map((t) => [t.taskKey, t.status]));
    const incompletePrereqs = target.prerequisiteKeys.filter(
      (k) => statusByKey.get(k) !== 'signed_off',
    );
    if (incompletePrereqs.length > 0) {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: `CLOSE_PREREQUISITE_INCOMPLETE:${incompletePrereqs.join(',')}`,
      };
    }
    if (target.requiresReconciliation && !input.reconciliation.passed) {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: `CLOSE_RECONCILIATION_FAILED:${input.reconciliation.issues.join(' | ')}`,
      };
    }
    return {
      ok: true,
      nextStatus: 'signed_off',
      signedOffBy: input.actorId,
      signedOffAt: input.occurredAt,
      signoffNote: trimmedNote.length > 0 ? trimmedNote : null,
      auditAction: 'close.task_signed_off',
    };
  }

  // action === 'reopen'
  if (target.status !== 'signed_off') {
    return {
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: 'INVALID_TASK_TRANSITION: Only signed-off close tasks can be reopened.',
    };
  }
  if (trimmedNote.length < 3) {
    return {
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: 'REOPEN_REASON_REQUIRED: Reopening a signed-off close task requires an explicit reason.',
    };
  }
  const signedOffDependents = input.tasks
    .filter((t) => t.status === 'signed_off' && t.prerequisiteKeys.includes(target.taskKey))
    .map((t) => t.taskKey);
  if (signedOffDependents.length > 0) {
    return {
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: `CLOSE_DEPENDENCY_CONFLICT: Reopen signed-off downstream task(s) first: ${signedOffDependents.join(',')}`,
    };
  }

  return {
    ok: true,
    nextStatus: 'reopened',
    signedOffBy: null,
    signedOffAt: null,
    signoffNote: trimmedNote,
    auditAction: 'close.task_reopened',
  };
}

export function evaluatePeriodLockTransition(input: {
  readonly currentStatus: PeriodLockStatus;
  readonly action: 'soft_close' | 'hard_close' | 'unlock';
  readonly actorRole: CloseMembershipRole;
  readonly reason: string;
  readonly hasCycle: boolean;
  readonly readyForHardClose: boolean;
  readonly incompleteTaskKeys: readonly string[];
  readonly reconciliationIssues: readonly string[];
}): PeriodLockTransitionOutcome {
  const trimmedReason = input.reason.trim();
  if (trimmedReason.length < 5) {
    return {
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: 'LOCK_REASON_REQUIRED: Period lock and unlock actions require a reason of at least 5 characters.',
    };
  }

  if (input.action === 'soft_close') {
    if (input.actorRole !== 'owner' && input.actorRole !== 'reviewer') {
      return {
        ok: false,
        errorCode: 'TENANT_FORBIDDEN',
        reason: `ROLE_FORBIDDEN: Role "${input.actorRole}" cannot soft-close a fiscal period.`,
      };
    }
    if (input.currentStatus !== 'open') {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: `INVALID_LOCK_TRANSITION: Cannot soft-close a period currently in "${input.currentStatus}" status.`,
      };
    }
    return {
      ok: true,
      nextStatus: 'soft_closed',
      auditAction: 'period.soft_closed',
    };
  }

  if (input.action === 'hard_close') {
    if (input.actorRole !== 'owner' && input.actorRole !== 'reviewer') {
      return {
        ok: false,
        errorCode: 'TENANT_FORBIDDEN',
        reason: `ROLE_FORBIDDEN: Role "${input.actorRole}" cannot hard-close a fiscal period.`,
      };
    }
    if (input.currentStatus === 'hard_closed') {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: 'INVALID_LOCK_TRANSITION: Period is already hard-closed.',
      };
    }
    if (!input.hasCycle) {
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: 'CLOSE_NOT_READY: Initialize the period close cycle and sign off all tasks before hard-closing.',
      };
    }
    if (!input.readyForHardClose) {
      const reasons: string[] = [];
      if (input.incompleteTaskKeys.length > 0) {
        reasons.push(`incomplete tasks [${input.incompleteTaskKeys.join(', ')}]`);
      }
      if (input.reconciliationIssues.length > 0) {
        reasons.push(`reconciliation failures [${input.reconciliationIssues.join('; ')}]`);
      }
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        reason: `CLOSE_NOT_READY: Period cannot be hard-closed (${reasons.join(' and ')}).`,
      };
    }
    return {
      ok: true,
      nextStatus: 'hard_closed',
      auditAction: 'period.hard_closed',
    };
  }

  // action === 'unlock'
  if (input.actorRole !== 'owner') {
    return {
      ok: false,
      errorCode: 'TENANT_FORBIDDEN',
      reason: `ROLE_FORBIDDEN: Only a company owner may unlock a closed period (actor role "${input.actorRole}").`,
    };
  }
  if (input.currentStatus === 'open') {
    return {
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      reason: 'INVALID_LOCK_TRANSITION: Period is already open.',
    };
  }
  return {
    ok: true,
    nextStatus: 'open',
    auditAction: 'period.unlocked',
  };
}

/**
 * Evaluates GL/period writes against fiscal period locks (CLS3):
 *  - `hard_closed` blocks writes atomically (`allowed: false`)
 *  - `soft_closed` permits writes with an explicit `SOFT_CLOSE_WRITE_WARNING`
 */
export function evaluatePeriodWriteGuard(
  targets: readonly PeriodWriteTarget[],
): PeriodWriteGuardResult {
  const unique = new Map<string, PeriodWriteTarget>();
  for (const target of targets) {
    if (!unique.has(target.id)) unique.set(target.id, target);
  }
  const sorted = [...unique.values()].sort((a, b) =>
    a.fiscalYear !== b.fiscalYear ? a.fiscalYear - b.fiscalYear : a.code.localeCompare(b.code),
  );

  const blockedPeriods: PeriodWriteAdvisory[] = [];
  const warnings: PeriodWriteAdvisory[] = [];

  for (const period of sorted) {
    if (period.lockStatus === 'hard_closed') {
      blockedPeriods.push({
        periodId: period.id,
        periodCode: period.code,
        fiscalYear: period.fiscalYear,
        lockStatus: 'hard_closed',
        code: 'HARD_CLOSE_WRITE_BLOCKED',
        message: `FY${period.fiscalYear} ${period.code} is hard-closed; unlock the period with an audited reason before posting.`,
      });
    } else if (period.lockStatus === 'soft_closed') {
      warnings.push({
        periodId: period.id,
        periodCode: period.code,
        fiscalYear: period.fiscalYear,
        lockStatus: 'soft_closed',
        code: 'SOFT_CLOSE_WRITE_WARNING',
        message: `FY${period.fiscalYear} ${period.code} is soft-closed; posting was accepted with a soft-close warning and audited.`,
      });
    }
  }

  return {
    allowed: blockedPeriods.length === 0,
    blockedPeriods,
    warnings,
  };
}
