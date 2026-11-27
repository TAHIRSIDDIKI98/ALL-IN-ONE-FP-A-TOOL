import { describe, expect, it } from 'vitest';
import {
  addUtcDaysToPeriodDate,
  computeCloseTaskDagState,
  derivePeriodCloseStatus,
  evaluateCloseReconciliation,
  evaluateCloseTaskTransition,
  evaluatePeriodLockTransition,
  evaluatePeriodWriteGuard,
  validateCloseTaskDag,
  type CloseTaskSnapshot,
  type CloseTaskTemplateInput,
} from './index.js';

const STANDARD_TEMPLATES: readonly CloseTaskTemplateInput[] = [
  {
    taskKey: 'import_gl',
    title: 'Import GL actuals',
    category: 'import',
    ownerRole: 'editor',
    dueDayOffset: 1,
    prerequisiteKeys: [],
    requiresReconciliation: false,
    sortOrder: 1,
  },
  {
    taskKey: 'reconcile_tb',
    title: 'Reconcile TB & statements',
    category: 'reconciliation',
    ownerRole: 'editor',
    dueDayOffset: 3,
    prerequisiteKeys: ['import_gl'],
    requiresReconciliation: true,
    sortOrder: 2,
  },
  {
    taskKey: 'cfo_review',
    title: 'Controller & CFO review',
    category: 'review',
    ownerRole: 'reviewer',
    dueDayOffset: 5,
    prerequisiteKeys: ['reconcile_tb'],
    requiresReconciliation: true,
    sortOrder: 3,
  },
];

function makeTasks(overrides: Partial<Record<string, Partial<CloseTaskSnapshot>>> = {}): CloseTaskSnapshot[] {
  return STANDARD_TEMPLATES.map((tpl, idx) => ({
    id: `task-${idx + 1}`,
    taskKey: tpl.taskKey,
    title: tpl.title,
    category: tpl.category,
    ownerRole: tpl.ownerRole,
    dueDate: addUtcDaysToPeriodDate('2026-01-31', tpl.dueDayOffset),
    prerequisiteKeys: tpl.prerequisiteKeys,
    requiresReconciliation: tpl.requiresReconciliation,
    status: 'pending',
    sortOrder: tpl.sortOrder,
    signedOffBy: null,
    signedOffAt: null,
    signoffNote: null,
    version: 1,
    ...overrides[tpl.taskKey],
  }));
}

describe('WI-0045 Close Management & Period Lock Engine (§12.6 CLS1–CLS4)', () => {
  it('validates task DAG topological ordering and rejects cycles, self-deps, duplicate keys, and unknown prerequisites (CLS1)', () => {
    const valid = validateCloseTaskDag(STANDARD_TEMPLATES);
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.ordered.map((t) => t.taskKey)).toEqual(['import_gl', 'reconcile_tb', 'cfo_review']);
    }

    expect(addUtcDaysToPeriodDate('2026-01-31', 5)).toBe('2026-02-05');

    const cycle = validateCloseTaskDag([
      { ...STANDARD_TEMPLATES[0]!, prerequisiteKeys: ['cfo_review'] },
      STANDARD_TEMPLATES[1]!,
      STANDARD_TEMPLATES[2]!,
    ]);
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) {
      expect(cycle.reason).toContain('CLOSE_DAG_CYCLE');
    }

    const selfDep = validateCloseTaskDag([
      { ...STANDARD_TEMPLATES[0]!, prerequisiteKeys: ['import_gl'] },
    ]);
    expect(selfDep.ok).toBe(false);
    if (!selfDep.ok) expect(selfDep.reason).toContain('SELF_DEPENDENCY');

    const unknown = validateCloseTaskDag([
      { ...STANDARD_TEMPLATES[0]!, prerequisiteKeys: ['missing_task'] },
    ]);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toContain('UNKNOWN_PREREQUISITE_KEY');

    const dup = validateCloseTaskDag([STANDARD_TEMPLATES[0]!, STANDARD_TEMPLATES[0]!]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toContain('DUPLICATE_TASK_KEY');
  });

  it('enforces prerequisite sign-off order, reconciliation gate, RBAC, optimistic concurrency, and safe reopen (CLS1, CLS2)', () => {
    const cleanRec = evaluateCloseReconciliation({
      trialBalanceBalanced: true,
      unmappedOrQuarantinedCount: 0,
      statementArticulationValid: true,
      hasActualsInPeriod: true,
    });
    expect(cleanRec.passed).toBe(true);

    const failedRec = evaluateCloseReconciliation({
      trialBalanceBalanced: true,
      unmappedOrQuarantinedCount: 2,
      statementArticulationValid: false,
      hasActualsInPeriod: true,
    });
    expect(failedRec.passed).toBe(false);
    expect(failedRec.issues.length).toBe(2);

    const initialTasks = makeTasks();
    const dagBefore = computeCloseTaskDagState(initialTasks, cleanRec);
    expect(dagBefore.map((t) => t.isUnlocked)).toEqual([true, false, false]);

    // Cannot sign off reconcile_tb before import_gl
    const premature = evaluateCloseTaskTransition({
      tasks: initialTasks,
      taskId: 'task-2',
      action: 'sign_off',
      actorRole: 'editor',
      actorId: 'u-editor',
      periodLockStatus: 'open',
      reconciliation: cleanRec,
      expectedVersion: 1,
      occurredAt: '2026-02-01T10:00:00Z',
    });
    expect(premature.ok).toBe(false);
    if (!premature.ok) expect(premature.reason).toContain('CLOSE_PREREQUISITE_INCOMPLETE:import_gl');

    // Editor signs off import_gl; viewer denied; stale version returns MODEL_VERSION_LOCKED
    const viewerDenied = evaluateCloseTaskTransition({
      tasks: initialTasks,
      taskId: 'task-1',
      action: 'sign_off',
      actorRole: 'viewer',
      actorId: 'u-viewer',
      periodLockStatus: 'open',
      reconciliation: cleanRec,
      expectedVersion: 1,
      occurredAt: '2026-02-01T10:00:00Z',
    });
    expect(viewerDenied.ok).toBe(false);
    if (!viewerDenied.ok) expect(viewerDenied.errorCode).toBe('TENANT_FORBIDDEN');

    const staleVersion = evaluateCloseTaskTransition({
      tasks: initialTasks,
      taskId: 'task-1',
      action: 'sign_off',
      actorRole: 'editor',
      actorId: 'u-editor',
      periodLockStatus: 'open',
      reconciliation: cleanRec,
      expectedVersion: 99,
      occurredAt: '2026-02-01T10:00:00Z',
    });
    expect(staleVersion.ok).toBe(false);
    if (!staleVersion.ok) expect(staleVersion.errorCode).toBe('MODEL_VERSION_LOCKED');

    // Sign off import_gl -> reconcile_tb blocked if reconciliation fails
    const step1Tasks = makeTasks({
      import_gl: { status: 'signed_off', signedOffBy: 'u-editor', signedOffAt: '2026-02-01T10:00:00Z' },
    });
    const recBlocked = evaluateCloseTaskTransition({
      tasks: step1Tasks,
      taskId: 'task-2',
      action: 'sign_off',
      actorRole: 'editor',
      actorId: 'u-editor',
      periodLockStatus: 'open',
      reconciliation: failedRec,
      expectedVersion: 1,
      occurredAt: '2026-02-01T11:00:00Z',
    });
    expect(recBlocked.ok).toBe(false);
    if (!recBlocked.ok) expect(recBlocked.reason).toContain('CLOSE_RECONCILIATION_FAILED');

    // Cannot reopen import_gl while reconcile_tb is already signed off
    const bothSigned = makeTasks({
      import_gl: { status: 'signed_off', signedOffBy: 'u-editor', signedOffAt: '2026-02-01T10:00:00Z' },
      reconcile_tb: { status: 'signed_off', signedOffBy: 'u-editor', signedOffAt: '2026-02-01T11:00:00Z' },
    });
    const reopenConflict = evaluateCloseTaskTransition({
      tasks: bothSigned,
      taskId: 'task-1',
      action: 'reopen',
      actorRole: 'owner',
      actorId: 'u-owner',
      periodLockStatus: 'open',
      reconciliation: cleanRec,
      expectedVersion: 1,
      note: 'Need restatement',
      occurredAt: '2026-02-01T12:00:00Z',
    });
    expect(reopenConflict.ok).toBe(false);
    if (!reopenConflict.ok) expect(reopenConflict.reason).toContain('CLOSE_DEPENDENCY_CONFLICT');
  });

  it('derives close status from tasks and reconciliation, enforces lock/unlock rules, and guards period writes (CLS3, CLS4)', () => {
    const cleanRec = evaluateCloseReconciliation({
      trialBalanceBalanced: true,
      unmappedOrQuarantinedCount: 0,
      statementArticulationValid: true,
      hasActualsInPeriod: true,
    });
    const failedRec = evaluateCloseReconciliation({
      trialBalanceBalanced: false,
      unmappedOrQuarantinedCount: 0,
      statementArticulationValid: false,
      hasActualsInPeriod: true,
    });

    expect(
      derivePeriodCloseStatus({ tasks: makeTasks(), lockStatus: 'open', reconciliation: cleanRec }).derivedStatus,
    ).toBe('not_started');

    expect(
      derivePeriodCloseStatus({
        tasks: makeTasks({ import_gl: { status: 'signed_off', signedOffBy: 'u1', signedOffAt: '2026-02-01T00:00:00Z' } }),
        lockStatus: 'open',
        reconciliation: cleanRec,
      }).completionPct,
    ).toBe('33.33');

    expect(
      derivePeriodCloseStatus({ tasks: makeTasks(), lockStatus: 'open', reconciliation: failedRec }).derivedStatus,
    ).toBe('blocked_reconciliation');

    const allSigned = makeTasks({
      import_gl: { status: 'signed_off', signedOffBy: 'u1', signedOffAt: '2026-02-01T00:00:00Z' },
      reconcile_tb: { status: 'signed_off', signedOffBy: 'u1', signedOffAt: '2026-02-01T00:00:00Z' },
      cfo_review: { status: 'signed_off', signedOffBy: 'u2', signedOffAt: '2026-02-01T00:00:00Z' },
    });
    const readySummary = derivePeriodCloseStatus({
      tasks: allSigned,
      lockStatus: 'open',
      reconciliation: cleanRec,
    });
    expect(readySummary.derivedStatus).toBe('ready_to_close');
    expect(readySummary.readyForHardClose).toBe(true);
    expect(readySummary.completionPct).toBe('100.00');

    // Hard-close rejected if cycle not ready
    const notReadyLock = evaluatePeriodLockTransition({
      currentStatus: 'open',
      action: 'hard_close',
      actorRole: 'owner',
      reason: 'Month-end close finalized',
      hasCycle: true,
      readyForHardClose: false,
      incompleteTaskKeys: ['cfo_review'],
      reconciliationIssues: [],
    });
    expect(notReadyLock.ok).toBe(false);
    if (!notReadyLock.ok) expect(notReadyLock.reason).toContain('CLOSE_NOT_READY');

    // Reviewer can hard-close when ready, but only owner can unlock
    const hardLock = evaluatePeriodLockTransition({
      currentStatus: 'soft_closed',
      action: 'hard_close',
      actorRole: 'reviewer',
      reason: 'All tasks signed off and tied',
      hasCycle: true,
      readyForHardClose: true,
      incompleteTaskKeys: [],
      reconciliationIssues: [],
    });
    expect(hardLock.ok).toBe(true);

    const reviewerUnlock = evaluatePeriodLockTransition({
      currentStatus: 'hard_closed',
      action: 'unlock',
      actorRole: 'reviewer',
      reason: 'Late accrual adjustment',
      hasCycle: true,
      readyForHardClose: true,
      incompleteTaskKeys: [],
      reconciliationIssues: [],
    });
    expect(reviewerUnlock.ok).toBe(false);
    if (!reviewerUnlock.ok) expect(reviewerUnlock.errorCode).toBe('TENANT_FORBIDDEN');

    const ownerUnlock = evaluatePeriodLockTransition({
      currentStatus: 'hard_closed',
      action: 'unlock',
      actorRole: 'owner',
      reason: 'Late audit adjustment approved by controller',
      hasCycle: true,
      readyForHardClose: true,
      incompleteTaskKeys: [],
      reconciliationIssues: [],
    });
    expect(ownerUnlock.ok).toBe(true);

    // Period write guard: soft-close warns, hard-close blocks
    const softGuard = evaluatePeriodWriteGuard([
      { id: 'p1', code: 'P01', fiscalYear: 2026, lockStatus: 'soft_closed' },
    ]);
    expect(softGuard.allowed).toBe(true);
    expect(softGuard.warnings[0]?.code).toBe('SOFT_CLOSE_WRITE_WARNING');

    const hardGuard = evaluatePeriodWriteGuard([
      { id: 'p1', code: 'P01', fiscalYear: 2026, lockStatus: 'soft_closed' },
      { id: 'p2', code: 'P02', fiscalYear: 2026, lockStatus: 'hard_closed' },
    ]);
    expect(hardGuard.allowed).toBe(false);
    expect(hardGuard.blockedPeriods[0]?.periodCode).toBe('P02');
  });
});
