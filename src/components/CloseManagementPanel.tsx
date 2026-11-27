import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  ApiClientError,
  createApiClient,
  type CloseTaskSummary,
  type CloseTaskTemplateInput,
  type CloseWorkspaceResponse,
} from '../api/client.js';
import type { SpineRoutePath } from '../../shared/spine.js';
import {
  InlineEmptyState,
  InlineErrorState,
  LoadingState,
  PartialBanner,
} from './StateFrame.js';

export interface CloseManagementPanelProps {
  readonly companyId: string | null;
  readonly authToken: string | null;
  readonly fiscalYear: number;
  readonly onNavigate: (path: SpineRoutePath) => void;
  readonly onOpenExceptions?: () => void;
  readonly forcedState?: 'loading' | 'empty' | 'error';
}

interface CloseFailure {
  readonly code: string;
  readonly message: string;
}

const STANDARD_CLOSE_TEMPLATES: CloseTaskTemplateInput[] = [
  {
    taskKey: 'import_actuals',
    title: 'Import GL actuals & map CoA',
    category: 'import',
    ownerRole: 'editor',
    dueDayOffset: 1,
    prerequisiteKeys: [],
    requiresReconciliation: false,
    sortOrder: 1,
  },
  {
    taskKey: 'reconcile_statements',
    title: 'Reconcile Trial Balance & A1–A5 statements',
    category: 'reconciliation',
    ownerRole: 'editor',
    dueDayOffset: 3,
    prerequisiteKeys: ['import_actuals'],
    requiresReconciliation: true,
    sortOrder: 2,
  },
  {
    taskKey: 'variance_review',
    title: 'Review BvA flux & unplanned variances',
    category: 'review',
    ownerRole: 'reviewer',
    dueDayOffset: 4,
    prerequisiteKeys: ['reconcile_statements'],
    requiresReconciliation: true,
    sortOrder: 3,
  },
  {
    taskKey: 'controller_signoff',
    title: 'Controller final close sign-off',
    category: 'lock',
    ownerRole: 'owner',
    dueDayOffset: 5,
    prerequisiteKeys: ['variance_review'],
    requiresReconciliation: true,
    sortOrder: 4,
  },
];

function toCloseFailure(error: unknown): CloseFailure {
  if (error instanceof ApiClientError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'Close workspace request failed.',
  };
}

function formatDerivedLabel(status: string): string {
  switch (status) {
    case 'not_started':
      return 'Not started';
    case 'in_progress':
      return 'In progress';
    case 'blocked_reconciliation':
      return 'Blocked (reconciliation)';
    case 'ready_to_close':
      return 'Ready for hard close';
    case 'soft_closed':
      return 'Soft closed';
    case 'hard_closed':
      return 'Hard closed';
    default:
      return status;
  }
}

export function CloseManagementPanel(props: CloseManagementPanelProps): ReactElement {
  const { companyId, authToken, fiscalYear, onNavigate, onOpenExceptions, forcedState } = props;

  const [selectedYear, setSelectedYear] = useState<number>(fiscalYear);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('P01');
  const [workspace, setWorkspace] = useState<CloseWorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailure, setLoadFailure] = useState<CloseFailure | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionFailure, setActionFailure] = useState<CloseFailure | null>(null);
  const [taskNotes, setTaskNotes] = useState<Readonly<Record<string, string>>>({});
  const [lockReason, setLockReason] = useState('');
  const [newTaskKey, setNewTaskKey] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPrereq, setNewTaskPrereq] = useState('');
  const [newTaskOwnerRole, setNewTaskOwnerRole] = useState<'owner' | 'editor' | 'reviewer'>('editor');
  const [newTaskRequiresRec, setNewTaskRequiresRec] = useState(true);

  const loadWorkspace = useCallback(async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    setLoading(true);
    setLoadFailure(null);
    try {
      const result = await createApiClient({ getToken: () => authToken }).getCloseWorkspace(
        companyId,
        { year: selectedYear, period: selectedPeriod },
      );
      setWorkspace(result);
    } catch (error) {
      setWorkspace(null);
      setLoadFailure(toCloseFailure(error));
    } finally {
      setLoading(false);
    }
  }, [authToken, companyId, selectedPeriod, selectedYear]);

  useEffect(() => {
    if (companyId === null || authToken === null) return;
    void loadWorkspace();
  }, [authToken, companyId, loadWorkspace]);

  const installStandardTemplates = async (): Promise<void> => {
    if (companyId === null || authToken === null) return;
    setActionBusy(true);
    setActionFailure(null);
    try {
      await createApiClient({ getToken: () => authToken }).upsertCloseTemplates(companyId, {
        templates: STANDARD_CLOSE_TEMPLATES,
      });
      await loadWorkspace();
    } catch (error) {
      setActionFailure(toCloseFailure(error));
    } finally {
      setActionBusy(false);
    }
  };

  const addTemplateTask = async (): Promise<void> => {
    if (companyId === null || authToken === null || workspace === null) return;
    setActionBusy(true);
    setActionFailure(null);
    try {
      const nextSort = workspace.templates.reduce((acc, t) => Math.max(acc, t.sortOrder), 0) + 1;
      const existing: CloseTaskTemplateInput[] = workspace.templates.map((t) => ({
        taskKey: t.taskKey,
        title: t.title,
        category: t.category,
        ownerRole: t.ownerRole,
        dueDayOffset: t.dueDayOffset,
        prerequisiteKeys: [...t.prerequisiteKeys],
        requiresReconciliation: t.requiresReconciliation,
        sortOrder: t.sortOrder,
      }));
      const prereqs = newTaskPrereq
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      await createApiClient({ getToken: () => authToken }).upsertCloseTemplates(companyId, {
        templates: [
          ...existing,
          {
            taskKey: newTaskKey.trim(),
            title: newTaskTitle.trim(),
            category: 'review',
            ownerRole: newTaskOwnerRole,
            dueDayOffset: 5,
            prerequisiteKeys: prereqs,
            requiresReconciliation: newTaskRequiresRec,
            sortOrder: nextSort,
          },
        ],
      });
      setNewTaskKey('');
      setNewTaskTitle('');
      setNewTaskPrereq('');
      await loadWorkspace();
    } catch (error) {
      setActionFailure(toCloseFailure(error));
    } finally {
      setActionBusy(false);
    }
  };

  const initializeCycle = async (): Promise<void> => {
    if (companyId === null || authToken === null || workspace === null) return;
    setActionBusy(true);
    setActionFailure(null);
    try {
      const updated = await createApiClient({ getToken: () => authToken }).initializeCloseCycle(
        companyId,
        {
          fiscalYear: workspace.selectedFiscalYear,
          periodCode: workspace.selectedPeriodCode,
        },
      );
      setWorkspace(updated);
    } catch (error) {
      setActionFailure(toCloseFailure(error));
    } finally {
      setActionBusy(false);
    }
  };

  const runTaskAction = async (
    task: CloseTaskSummary,
    action: 'start' | 'sign_off' | 'reopen',
  ): Promise<void> => {
    if (companyId === null || authToken === null || workspace === null || workspace.cycle === null) {
      return;
    }
    setActionBusy(true);
    setActionFailure(null);
    try {
      const note = taskNotes[task.id]?.trim();
      const updated = await createApiClient({ getToken: () => authToken }).transitionCloseTask(
        companyId,
        workspace.cycle.id,
        task.id,
        {
          action,
          expectedVersion: task.version,
          ...(note !== undefined && note.length > 0 ? { note } : {}),
        },
      );
      setWorkspace(updated);
    } catch (error) {
      setActionFailure(toCloseFailure(error));
    } finally {
      setActionBusy(false);
    }
  };

  const runLockAction = async (action: 'soft_close' | 'hard_close' | 'unlock'): Promise<void> => {
    if (companyId === null || authToken === null || workspace === null) return;
    setActionBusy(true);
    setActionFailure(null);
    try {
      const updated = await createApiClient({ getToken: () => authToken }).transitionPeriodLock(
        companyId,
        workspace.selectedPeriodId,
        {
          action,
          reason: lockReason.trim(),
        },
      );
      setLockReason('');
      setWorkspace(updated);
    } catch (error) {
      setActionFailure(toCloseFailure(error));
    } finally {
      setActionBusy(false);
    }
  };

  if (forcedState === 'loading' || loading) {
    return <LoadingState label="Loading close checklist, task DAG, and period lock status..." />;
  }

  if (forcedState === 'error' || loadFailure !== null) {
    return (
      <InlineErrorState
        code={loadFailure?.code ?? 'INTERNAL_ERROR'}
        message={loadFailure?.message ?? 'Close management workspace could not be loaded.'}
        onRetry={() => void loadWorkspace()}
      />
    );
  }

  if (forcedState === 'empty' || companyId === null || authToken === null) {
    return (
      <InlineEmptyState
        disclosure="No active company workspace. Sign in and create a company workspace before managing period close checklists and locks."
        ctaLabel="Go to Company Setup"
        onAction={() => onNavigate('/setup')}
      />
    );
  }

  if (workspace === null) {
    return (
      <InlineEmptyState
        disclosure="Close workspace not loaded. Refresh to load the fiscal close calendar and period lock status."
        ctaLabel="Load Close Workspace"
        onAction={() => void loadWorkspace()}
      />
    );
  }

  const years = [...new Set(workspace.periods.map((p) => p.fiscalYear))].sort((a, b) => a - b);
  const periodsForYear = workspace.periods.filter((p) => p.fiscalYear === workspace.selectedFiscalYear);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="close-fiscal-year" className="block text-xs font-medium text-slate-700">
              Fiscal Year
            </label>
            <select
              id="close-fiscal-year"
              value={workspace.selectedFiscalYear}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
              className="mt-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              {years.map((yr) => (
                <option key={yr} value={yr}>
                  FY{yr}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="close-period-code" className="block text-xs font-medium text-slate-700">
              Fiscal Period
            </label>
            <select
              id="close-period-code"
              value={workspace.selectedPeriodCode}
              onChange={(event) => setSelectedPeriod(event.target.value)}
              className="mt-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              {periodsForYear.map((p) => (
                <option key={p.periodId} value={p.periodCode}>
                  {p.periodCode} · {p.label} ({p.lockStatus})
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void loadWorkspace()}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh close status
          </button>
          {onOpenExceptions !== undefined ? (
            <button
              type="button"
              onClick={onOpenExceptions}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open Exceptions Inbox
            </button>
          ) : null}
        </div>

        <div className="text-right text-xs text-slate-600">
          <div>
            Role: <span className="font-mono font-medium text-slate-900">{workspace.actorRole}</span>
          </div>
          <div>
            Derived status:{' '}
            <span className="font-mono font-semibold text-slate-900">
              {formatDerivedLabel(workspace.statusSummary.derivedStatus)}
            </span>{' '}
            · Lock:{' '}
            <span className="font-mono font-semibold text-slate-900">
              {workspace.statusSummary.lockStatus}
            </span>
          </div>
          <div>
            Progress:{' '}
            <span className="font-mono">
              {workspace.statusSummary.signedOffCount}/{workspace.statusSummary.totalTasks} (
              {workspace.statusSummary.completionPct}%)
            </span>
          </div>
        </div>
      </div>

      {actionFailure !== null && (
        <InlineErrorState
          code={actionFailure.code}
          message={actionFailure.message}
          onRetry={() => setActionFailure(null)}
        />
      )}

      {!workspace.reconciliation.passed && (
        <PartialBanner
          detail={`Reconciliation gate blocked (${workspace.reconciliation.issues.join(' | ')}). Resolve issues before signing off reconciliation-gated tasks or hard-closing.`}
        />
      )}

      {workspace.statusSummary.lockStatus === 'soft_closed' && (
        <PartialBanner
          detail={`FY${workspace.selectedFiscalYear} ${workspace.selectedPeriodCode} is soft-closed: late GL imports succeed with an audited warning.`}
        />
      )}

      {workspace.statusSummary.lockStatus === 'hard_closed' && (
        <PartialBanner
          detail={`FY${workspace.selectedFiscalYear} ${workspace.selectedPeriodCode} is hard-closed: GL postings and close task edits are blocked until an owner records an audited unlock.`}
        />
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Close Calendar Templates ({workspace.templates.length})
            </h2>
            <p className="text-xs text-slate-600">
              DAG prerequisites determine unlock order; close status is derived from task sign-offs and reconciliation gates.
            </p>
          </div>
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void installStandardTemplates()}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Install Standard 4-Step Close Calendar
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-5">
          <input
            type="text"
            aria-label="New template task key"
            placeholder="task_key (e.g. tax_review)"
            value={newTaskKey}
            onChange={(e) => setNewTaskKey(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-xs font-mono"
          />
          <input
            type="text"
            aria-label="New template task title"
            placeholder="Task title"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <input
            type="text"
            aria-label="Prerequisite task keys"
            placeholder="Prerequisites (comma keys)"
            value={newTaskPrereq}
            onChange={(e) => setNewTaskPrereq(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-xs font-mono"
          />
          <select
            aria-label="Template owner role"
            value={newTaskOwnerRole}
            onChange={(e) => setNewTaskOwnerRole(e.target.value as 'owner' | 'editor' | 'reviewer')}
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="editor">editor</option>
            <option value="reviewer">reviewer</option>
            <option value="owner">owner</option>
          </select>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={newTaskRequiresRec}
                onChange={(e) => setNewTaskRequiresRec(e.target.checked)}
              />
              Reconcile
            </label>
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void addTemplateTask()}
              className="rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800"
            >
              Add Template Task
            </button>
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Period Close Checklist · FY{workspace.selectedFiscalYear} {workspace.selectedPeriodCode}
          </h2>
          {workspace.cycle === null && (
            <button
              type="button"
              disabled={actionBusy || workspace.templates.length === 0}
              onClick={() => void initializeCycle()}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Initialize Close Cycle
            </button>
          )}
        </div>

        {workspace.cycle === null ? (
          <p className="mt-2 text-xs text-slate-600">
            {workspace.templates.length === 0
              ? 'Install or add close calendar templates above before initializing a cycle for this period.'
              : 'No close cycle initialized yet for this period. Click Initialize Close Cycle to instantiate the task DAG.'}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <caption className="sr-only">Close task DAG checklist</caption>
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-2 py-1.5">Task</th>
                  <th className="px-2 py-1.5">Role</th>
                  <th className="px-2 py-1.5">Due</th>
                  <th className="px-2 py-1.5">Prerequisites</th>
                  <th className="px-2 py-1.5">Status</th>
                  <th className="px-2 py-1.5">Note</th>
                  <th className="px-2 py-1.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workspace.tasks.map((task) => (
                  <tr key={task.id}>
                    <td className="px-2 py-2">
                      <div className="font-medium text-slate-900">{task.title}</div>
                      <div className="font-mono text-slate-500">
                        {task.taskKey} · v{task.version}
                        {task.requiresReconciliation ? ' · reconciliation-gated' : ''}
                      </div>
                    </td>
                    <td className="px-2 py-2 font-mono">{task.ownerRole}</td>
                    <td className="px-2 py-2 font-mono">{task.dueDate}</td>
                    <td className="px-2 py-2 font-mono text-slate-600">
                      {task.prerequisiteKeys.length === 0 ? 'none' : task.prerequisiteKeys.join(', ')}
                      {!task.isUnlocked && task.status !== 'signed_off' && (
                        <div className="text-amber-700">{task.blockingReasons.join('; ')}</div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="font-mono font-medium">{task.status}</div>
                      {task.signedOffByEmail !== null && (
                        <div className="text-slate-500">by {task.signedOffByEmail}</div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        aria-label={`Note for ${task.taskKey}`}
                        placeholder="Sign-off / reopen note"
                        value={taskNotes[task.id] ?? ''}
                        onChange={(e) =>
                          setTaskNotes((prev) => ({ ...prev, [task.id]: e.target.value }))
                        }
                        className="w-40 rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="px-2 py-2 text-right space-x-1">
                      {(task.status === 'pending' || task.status === 'reopened') && (
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => void runTaskAction(task, 'start')}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Start
                        </button>
                      )}
                      {task.status !== 'signed_off' ? (
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => void runTaskAction(task, 'sign_off')}
                          className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800"
                        >
                          Sign off
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => void runTaskAction(task, 'reopen')}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Reopen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Period Lock Controls & Audit History ({workspace.selectedPeriodCode})
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          Soft-close warns on GL imports; hard-close blocks writes until an owner records an explicit unlock reason.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            aria-label="Period lock or unlock reason"
            placeholder="Audit reason (min 5 chars)"
            value={lockReason}
            onChange={(e) => setLockReason(e.target.value)}
            className="min-w-64 rounded border border-slate-300 px-3 py-1.5 text-xs"
          />
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void runLockAction('soft_close')}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Soft Close
          </button>
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void runLockAction('hard_close')}
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            Hard Close
          </button>
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void runLockAction('unlock')}
            className="rounded border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50"
          >
            Unlock Period
          </button>
        </div>

        {workspace.lockEvents.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <caption className="sr-only">Immutable period lock and unlock audit events</caption>
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-2 py-1">When (UTC)</th>
                  <th className="px-2 py-1">Period</th>
                  <th className="px-2 py-1">Transition</th>
                  <th className="px-2 py-1">Actor</th>
                  <th className="px-2 py-1">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workspace.lockEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td className="px-2 py-1 font-mono">{ev.createdAt}</td>
                    <td className="px-2 py-1 font-mono">
                      FY{ev.fiscalYear} {ev.periodCode}
                    </td>
                    <td className="px-2 py-1 font-mono">
                      {ev.fromStatus} → {ev.toStatus} ({ev.action})
                    </td>
                    <td className="px-2 py-1">{ev.actorEmail}</td>
                    <td className="px-2 py-1">{ev.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
