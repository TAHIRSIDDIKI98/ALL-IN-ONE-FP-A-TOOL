import type { DriverDefinitionInput, ScenarioKind, ScenarioSummary } from '../../shared/planning.js';
import type {
  ApprovalStatus,
  CommentAnchorKind,
  CommentAnchorRequest,
  CreateWorkflowCommentRequest,
  MembershipRole,
  WorkflowNotificationSummary,
} from '../../shared/workflow.js';
import type {
  WorkforcePositionPayload,
  WorkforcePositionRecord,
  WorkforcePositionStatus,
} from '../../shared/workforce.js';
import type { PvmBridgeItemInput } from '../../shared/variance.js';

/**
 * Pure selection and driver-authoring rules for the planning view (WI-0032, WI-0033).
 *
 * Extracted from React components so fallback selection, driver-draft structural validation, and
 * wire payload assembly are unit-tested in one place. Performs ZERO arithmetic on money strings.
 */

export interface PlanningDefaults {
  readonly selectedScenario: string | null;
  readonly baseScenario: string | null;
  readonly targetScenario: string | null;
}

function keptIfStillPresent(
  names: readonly string[],
  previous: string | null,
): string | null {
  return previous !== null && names.includes(previous) ? previous : null;
}

/**
 * Resolves the planning view's selections against the scenarios the server just returned.
 * A previous choice survives only while that scenario still exists; otherwise the forecast opens on
 * the first `forecast` scenario (else the first scenario alphabetically), the comparison base is the
 * first scenario, and the comparison target is the second — `null` when only one exists, never a
 * made-up scenario name.
 */
export function resolvePlanningDefaults(
  scenarios: readonly ScenarioSummary[],
  previous: PlanningDefaults,
): PlanningDefaults {
  const names = scenarios.map((scenario) => scenario.name);
  const firstForecast = scenarios.find((scenario) => scenario.kind === 'forecast')?.name ?? null;
  const fallbackSelected = firstForecast ?? names[0] ?? null;

  return {
    selectedScenario: keptIfStillPresent(names, previous.selectedScenario) ?? fallbackSelected,
    baseScenario: keptIfStillPresent(names, previous.baseScenario) ?? names[0] ?? null,
    targetScenario: keptIfStillPresent(names, previous.targetScenario) ?? names[1] ?? null,
  };
}

/** `P01`..`Pnn` codes for a company's fiscal calendar; always at least one period. */
export function periodCodes(periodCount: number): readonly string[] {
  return Array.from({ length: Math.max(periodCount, 1) }, (_, index) =>
    `P${String(index + 1).padStart(2, '0')}`,
  );
}

export type DriverKind = 'fixed' | 'growth_rate' | 'percent_of_account' | 'price_times_volume';

export interface DriverOverrideDraft {
  readonly id: string;
  readonly periodCode: string;
  readonly amount: string;
}

export interface DriverRowDraft {
  readonly id: string;
  readonly kind: DriverKind;
  readonly driverKey: string;
  readonly accountCode: string;
  readonly assumptionLabel: string;
  readonly amount: string;
  readonly baseAmount: string;
  readonly ratePerPeriod: string;
  readonly sourceAccountCode: string;
  readonly ratio: string;
  readonly unitPrice: string;
  readonly volume: string;
  readonly unitPriceByPeriod: Readonly<Record<string, string>>;
  readonly volumeByPeriod: Readonly<Record<string, string>>;
  readonly overrides: readonly DriverOverrideDraft[];
}

export interface DriverPlanDraft {
  readonly scenarioName: string;
  readonly scenarioKind: ScenarioKind;
  readonly drivers: readonly DriverRowDraft[];
}

const CANONICAL_DECIMAL_RE = /^[+-]?\d+(?:\.\d+)?$/;

export function isCanonicalDecimalString(raw: string): boolean {
  return CANONICAL_DECIMAL_RE.test(raw.trim());
}

export function createEmptyDriverRow(id: string, defaultAccountCode = ''): DriverRowDraft {
  return {
    id,
    kind: 'fixed',
    driverKey: '',
    accountCode: defaultAccountCode,
    assumptionLabel: '',
    amount: '',
    baseAmount: '',
    ratePerPeriod: '',
    sourceAccountCode: '',
    ratio: '',
    unitPrice: '',
    volume: '',
    unitPriceByPeriod: {},
    volumeByPeriod: {},
    overrides: [],
  };
}

export function createInitialDriverPlanDraft(defaultAccountCode = ''): DriverPlanDraft {
  return {
    scenarioName: '',
    scenarioKind: 'forecast',
    drivers: [createEmptyDriverRow('driver-1', defaultAccountCode)],
  };
}

export type BuildDriverPlanResult =
  | {
      readonly ok: true;
      readonly scenarioName: string;
      readonly scenarioKind: ScenarioKind;
      readonly drivers: readonly DriverDefinitionInput[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly string[];
    };

/**
 * Validates user-entered driver rows strictly by string shape and builds typed wire payloads.
 * Performs no calculation; all quantitative evaluation and dependency graph checks run on the server.
 */
export function buildDriverDefinitions(
  draft: DriverPlanDraft,
  periods: readonly string[],
  options?: { readonly requireScenarioName?: boolean },
): BuildDriverPlanResult {
  const issues: string[] = [];
  const trimmedScenario = draft.scenarioName.trim();

  if (options?.requireScenarioName === true && trimmedScenario.length === 0) {
    issues.push('SCENARIO_NAME_REQUIRED: Enter a target scenario name before committing.');
  }

  if (periods.length === 0) {
    issues.push('EMPTY_PERIODS: At least one fiscal period is required.');
  }

  if (draft.drivers.length === 0) {
    issues.push('NO_DRIVERS: Add at least one driver definition before running a plan.');
  }

  const periodSet = new Set(periods);
  const built: DriverDefinitionInput[] = [];

  for (let rowIndex = 0; rowIndex < draft.drivers.length; rowIndex += 1) {
    const row = draft.drivers[rowIndex]!;
    const labelPrefix = `Driver ${String(rowIndex + 1)}`;
    const driverKey = row.driverKey.trim();
    const accountCode = row.accountCode.trim();
    const assumptionLabel = row.assumptionLabel.trim();

    if (driverKey.length === 0) {
      issues.push(`${labelPrefix}: driver key is required.`);
    }
    if (accountCode.length === 0) {
      issues.push(`${labelPrefix}: target account is required.`);
    }
    if (assumptionLabel.length === 0) {
      issues.push(`${labelPrefix}: assumption label is required.`);
    }

    const periodOverrides: Record<string, string> = {};
    const seenOverridePeriods = new Set<string>();
    let overrideFailed = false;

    for (const overrideRow of row.overrides) {
      const ovPeriod = overrideRow.periodCode.trim();
      const ovAmount = overrideRow.amount.trim();
      if (!periodSet.has(ovPeriod)) {
        issues.push(`${labelPrefix}: override period "${ovPeriod}" is not in the fiscal horizon.`);
        overrideFailed = true;
        continue;
      }
      if (seenOverridePeriods.has(ovPeriod)) {
        issues.push(`${labelPrefix}: duplicate override for period ${ovPeriod}.`);
        overrideFailed = true;
        continue;
      }
      if (!isCanonicalDecimalString(ovAmount)) {
        issues.push(
          `${labelPrefix}: override for ${ovPeriod} must be a canonical decimal string (e.g. 1250.00).`,
        );
        overrideFailed = true;
        continue;
      }
      seenOverridePeriods.add(ovPeriod);
      periodOverrides[ovPeriod] = ovAmount;
    }

    const overridesProp =
      Object.keys(periodOverrides).length > 0 ? { periodOverrides } : {};

    if (row.kind === 'fixed') {
      const amount = row.amount.trim();
      if (!isCanonicalDecimalString(amount)) {
        issues.push(`${labelPrefix}: fixed amount must be a canonical decimal string (e.g. 1000.00).`);
        continue;
      }
      if (driverKey.length > 0 && accountCode.length > 0 && assumptionLabel.length > 0 && !overrideFailed) {
        built.push({
          kind: 'fixed',
          driverKey,
          accountCode,
          assumptionLabel,
          amount,
          ...overridesProp,
        });
      }
    } else if (row.kind === 'growth_rate') {
      const baseAmount = row.baseAmount.trim();
      const ratePerPeriod = row.ratePerPeriod.trim();
      let paramError = false;
      if (!isCanonicalDecimalString(baseAmount)) {
        issues.push(
          `${labelPrefix}: base amount must be a canonical decimal string (e.g. 1000.00).`,
        );
        paramError = true;
      }
      if (!isCanonicalDecimalString(ratePerPeriod)) {
        issues.push(
          `${labelPrefix}: growth rate per period must be a decimal ratio (e.g. 0.05 for +5%).`,
        );
        paramError = true;
      }
      if (
        !paramError &&
        driverKey.length > 0 &&
        accountCode.length > 0 &&
        assumptionLabel.length > 0 &&
        !overrideFailed
      ) {
        built.push({
          kind: 'growth_rate',
          driverKey,
          accountCode,
          assumptionLabel,
          baseAmount,
          ratePerPeriod,
          ...overridesProp,
        });
      }
    } else if (row.kind === 'percent_of_account') {
      const sourceAccountCode = row.sourceAccountCode.trim();
      const ratio = row.ratio.trim();
      let paramError = false;
      if (sourceAccountCode.length === 0) {
        issues.push(`${labelPrefix}: source account code is required for percent_of_account.`);
        paramError = true;
      }
      if (!isCanonicalDecimalString(ratio)) {
        issues.push(`${labelPrefix}: ratio must be a canonical decimal string (e.g. 0.30).`);
        paramError = true;
      }
      if (
        !paramError &&
        driverKey.length > 0 &&
        accountCode.length > 0 &&
        assumptionLabel.length > 0 &&
        !overrideFailed
      ) {
        built.push({
          kind: 'percent_of_account',
          driverKey,
          accountCode,
          assumptionLabel,
          sourceAccountCode,
          ratio,
          ...overridesProp,
        });
      }
    } else {
      const unitPriceByPeriod: Record<string, string> = {};
      const volumeByPeriod: Record<string, string> = {};
      let pvError = false;
      const fallbackPrice = row.unitPrice.trim();
      const fallbackVolume = row.volume.trim();

      for (const periodCode of periods) {
        const cellPrice = (row.unitPriceByPeriod[periodCode] ?? '').trim();
        const effectivePrice = cellPrice.length > 0 ? cellPrice : fallbackPrice;
        const cellVolume = (row.volumeByPeriod[periodCode] ?? '').trim();
        const effectiveVolume = cellVolume.length > 0 ? cellVolume : fallbackVolume;

        if (!isCanonicalDecimalString(effectivePrice)) {
          issues.push(
            `${labelPrefix}: unit price for ${periodCode} must be a canonical decimal string.`,
          );
          pvError = true;
        }
        if (!isCanonicalDecimalString(effectiveVolume)) {
          issues.push(
            `${labelPrefix}: volume for ${periodCode} must be a canonical decimal string.`,
          );
          pvError = true;
        }
        if (!pvError) {
          unitPriceByPeriod[periodCode] = effectivePrice;
          volumeByPeriod[periodCode] = effectiveVolume;
        }
      }

      if (
        !pvError &&
        driverKey.length > 0 &&
        accountCode.length > 0 &&
        assumptionLabel.length > 0 &&
        !overrideFailed
      ) {
        built.push({
          kind: 'price_times_volume',
          driverKey,
          accountCode,
          assumptionLabel,
          unitPriceByPeriod,
          volumeByPeriod,
          ...overridesProp,
        });
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    scenarioName: trimmedScenario,
    scenarioKind: draft.scenarioKind,
    drivers: built,
  };
}

export interface CommentDraft {
  readonly planVersionId: string;
  readonly anchorKind: CommentAnchorKind;
  readonly accountCode: string;
  readonly periodCode: string;
  readonly statementLineKey: string;
  readonly body: string;
}

export function createInitialCommentDraft(
  defaultPlanVersionId = '',
  defaultAccountCode = '',
  defaultPeriodCode = 'P01',
): CommentDraft {
  return {
    planVersionId: defaultPlanVersionId,
    anchorKind: 'version',
    accountCode: defaultAccountCode,
    periodCode: defaultPeriodCode,
    statementLineKey: 'pl.revenue.service',
    body: '',
  };
}

export function buildCommentRequestPayload(
  draft: CommentDraft,
): { readonly ok: true; readonly payload: CreateWorkflowCommentRequest } | { readonly ok: false; readonly issues: readonly string[] } {
  const issues: string[] = [];
  const planVersionId = draft.planVersionId.trim();
  const body = draft.body.trim();

  if (planVersionId.length === 0) {
    issues.push('PLAN_VERSION_REQUIRED: Select a committed plan version before posting a comment.');
  }
  if (body.length === 0) {
    issues.push('COMMENT_BODY_REQUIRED: Enter a comment message before posting.');
  }

  let anchor: CommentAnchorRequest | null = null;
  if (draft.anchorKind === 'version') {
    anchor = { kind: 'version' };
  } else if (draft.anchorKind === 'account') {
    const accountCode = draft.accountCode.trim();
    if (accountCode.length === 0) {
      issues.push('ACCOUNT_CODE_REQUIRED: Select an account code for an account-anchored comment.');
    } else {
      anchor = { kind: 'account', accountCode };
    }
  } else if (draft.anchorKind === 'cell') {
    const accountCode = draft.accountCode.trim();
    const periodCode = draft.periodCode.trim();
    if (accountCode.length === 0) {
      issues.push('ACCOUNT_CODE_REQUIRED: Select an account code for a cell-anchored comment.');
    }
    if (periodCode.length === 0) {
      issues.push('PERIOD_CODE_REQUIRED: Select a fiscal period for a cell-anchored comment.');
    }
    if (accountCode.length > 0 && periodCode.length > 0) {
      anchor = { kind: 'cell', accountCode, periodCode };
    }
  } else {
    const statementLineKey = draft.statementLineKey.trim();
    if (statementLineKey.length === 0) {
      issues.push('STATEMENT_LINE_REQUIRED: Provide a statement line key (e.g. pl.revenue.service).');
    } else {
      anchor = { kind: 'statement_line', statementLineKey };
    }
  }

  if (issues.length > 0 || anchor === null) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    payload: {
      planVersionId,
      anchor,
      body,
    },
  };
}

export function unreadNotificationCount(
  notifications: readonly WorkflowNotificationSummary[],
): number {
  let count = 0;
  for (const item of notifications) {
    if (item.readAt === null) {
      count += 1;
    }
  }
  return count;
}

export type ApprovalActionKind = 'submit' | 'approve' | 'reject';

export function availableTaskActions(
  actorRole: MembershipRole,
  status: ApprovalStatus,
): readonly ApprovalActionKind[] {
  if (status === 'draft') {
    return actorRole === 'owner' || actorRole === 'editor' ? ['submit'] : [];
  }
  if (status === 'submitted') {
    return actorRole === 'owner' || actorRole === 'reviewer' ? ['approve', 'reject'] : [];
  }
  return [];
}

export interface WorkforcePositionDraft {
  readonly id: string;
  readonly positionCode: string;
  readonly title: string;
  readonly departmentName: string;
  readonly accountCode: string;
  readonly startPeriodCode: string;
  readonly endPeriodCode: string;
  readonly fte: string;
  readonly annualSalary: string;
  readonly burdenRate: string;
  readonly bonusRate: string;
  readonly rampFirstPeriodPct: string;
  readonly meritPeriodCode: string;
  readonly meritIncreasePct: string;
  readonly status: WorkforcePositionStatus;
}

export interface WorkforcePlanDraft {
  readonly scenarioName: string;
  readonly scenarioKind: ScenarioKind;
  readonly positions: readonly WorkforcePositionDraft[];
}

export function createEmptyWorkforcePositionDraft(
  id: string,
  defaultAccountCode = '',
  defaultStartPeriod = 'P01',
): WorkforcePositionDraft {
  return {
    id,
    positionCode: '',
    title: '',
    departmentName: '',
    accountCode: defaultAccountCode,
    startPeriodCode: defaultStartPeriod,
    endPeriodCode: '',
    fte: '1.00',
    annualSalary: '',
    burdenRate: '0.20',
    bonusRate: '0.00',
    rampFirstPeriodPct: '1.00',
    meritPeriodCode: '',
    meritIncreasePct: '0.00',
    status: 'active',
  };
}

export function createInitialWorkforceDraft(
  fiscalYear: number,
  defaultAccountCode = '',
  defaultStartPeriod = 'P01',
): WorkforcePlanDraft {
  return {
    scenarioName: `Workforce Plan FY${String(fiscalYear)}`,
    scenarioKind: 'forecast',
    positions: [createEmptyWorkforcePositionDraft('wf-pos-1', defaultAccountCode, defaultStartPeriod)],
  };
}

export function workforceDraftFromRecords(
  records: readonly WorkforcePositionRecord[],
  fiscalYear: number,
  defaultAccountCode = '',
  defaultStartPeriod = 'P01',
  previousDraft?: WorkforcePlanDraft,
): WorkforcePlanDraft {
  const scenarioName = previousDraft?.scenarioName ?? `Workforce Plan FY${String(fiscalYear)}`;
  const scenarioKind = previousDraft?.scenarioKind ?? 'forecast';
  if (records.length === 0) {
    return {
      scenarioName,
      scenarioKind,
      positions: [createEmptyWorkforcePositionDraft('wf-pos-1', defaultAccountCode, defaultStartPeriod)],
    };
  }
  return {
    scenarioName,
    scenarioKind,
    positions: records.map((rec, index) => ({
      id: `wf-rec-${rec.id || String(index)}`,
      positionCode: rec.positionCode,
      title: rec.title,
      departmentName: rec.departmentName,
      accountCode: rec.accountCode,
      startPeriodCode: rec.startPeriodCode,
      endPeriodCode: rec.endPeriodCode ?? '',
      fte: rec.fte,
      annualSalary: rec.annualSalary,
      burdenRate: rec.burdenRate,
      bonusRate: rec.bonusRate,
      rampFirstPeriodPct: rec.rampFirstPeriodPct,
      meritPeriodCode: rec.meritPeriodCode ?? '',
      meritIncreasePct: rec.meritIncreasePct,
      status: rec.status,
    })),
  };
}

export type BuildWorkforcePayloadResult =
  | {
      readonly ok: true;
      readonly scenarioName: string;
      readonly scenarioKind: ScenarioKind;
      readonly positions: readonly WorkforcePositionPayload[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly string[];
    };

/**
 * Validates Workforce position rows strictly by string shape & period order without performing any
 * compensation arithmetic. All monetary roll-ups and driver compilation run exclusively on the server.
 */
export function buildWorkforcePositionsPayload(
  draft: WorkforcePlanDraft,
  periods: readonly string[],
  options?: { readonly requireScenarioName?: boolean; readonly allowEmpty?: boolean },
): BuildWorkforcePayloadResult {
  const issues: string[] = [];
  const scenarioName = draft.scenarioName.trim();

  if (options?.requireScenarioName === true && scenarioName.length === 0) {
    issues.push('SCENARIO_NAME_REQUIRED: Enter a target scenario name before committing Workforce plan.');
  }

  if (periods.length === 0) {
    issues.push('EMPTY_PERIODS: At least one fiscal period is required.');
  }

  if (draft.positions.length === 0 && options?.allowEmpty !== true) {
    issues.push('NO_POSITIONS: Add at least one Workforce position before saving or running a preview.');
  }

  const periodIndex = new Map<string, number>();
  for (let i = 0; i < periods.length; i += 1) {
    periodIndex.set(periods[i]!, i);
  }

  const seenCodes = new Set<string>();
  const built: WorkforcePositionPayload[] = [];
  let activeCount = 0;

  for (let i = 0; i < draft.positions.length; i += 1) {
    const row = draft.positions[i]!;
    const label = `Position ${String(i + 1)}`;
    const positionCode = row.positionCode.trim().replace(/\s+/g, ' ');
    const title = row.title.trim();
    const departmentName = row.departmentName.trim();
    const accountCode = row.accountCode.trim();
    const startPeriodCode = row.startPeriodCode.trim();
    const endPeriodRaw = row.endPeriodCode.trim();
    const endPeriodCode = endPeriodRaw.length > 0 ? endPeriodRaw : null;
    const meritPeriodRaw = row.meritPeriodCode.trim();
    const meritPeriodCode = meritPeriodRaw.length > 0 ? meritPeriodRaw : null;

    if (positionCode.length === 0) {
      issues.push(`${label}: position code is required.`);
    } else if (seenCodes.has(positionCode)) {
      issues.push(`DUPLICATE_POSITION_CODE:${positionCode}`);
    } else {
      seenCodes.add(positionCode);
    }

    if (title.length === 0) {
      issues.push(`${label}: role title is required.`);
    }
    if (departmentName.length === 0) {
      issues.push(`${label}: department name is required.`);
    }
    if (accountCode.length === 0) {
      issues.push(`${label}: GL expense account is required.`);
    }

    const startIdx = periodIndex.get(startPeriodCode);
    if (startIdx === undefined) {
      issues.push(`${label}: start period "${startPeriodCode}" is not in the fiscal horizon.`);
    }

    let endIdx = periods.length - 1;
    if (endPeriodCode !== null) {
      const resolvedEnd = periodIndex.get(endPeriodCode);
      if (resolvedEnd === undefined) {
        issues.push(`${label}: end period "${endPeriodCode}" is not in the fiscal horizon.`);
      } else {
        endIdx = resolvedEnd;
      }
    }
    if (startIdx !== undefined && endIdx < startIdx) {
      issues.push(`${label}: end period cannot precede start period.`);
    }

    if (meritPeriodCode !== null && !periodIndex.has(meritPeriodCode)) {
      issues.push(`${label}: merit period "${meritPeriodCode}" is not in the fiscal horizon.`);
    }

    const decimalFields: readonly [string, string][] = [
      ['FTE', row.fte],
      ['annual salary', row.annualSalary],
      ['burden rate', row.burdenRate],
      ['bonus rate', row.bonusRate],
      ['first-period ramp', row.rampFirstPeriodPct],
      ['merit increase', row.meritIncreasePct],
    ];
    for (const [fieldName, rawValue] of decimalFields) {
      if (!isCanonicalDecimalString(rawValue)) {
        issues.push(`${label}: ${fieldName} must be a canonical decimal string.`);
      }
    }

    if (row.status === 'active') {
      activeCount += 1;
    }

    built.push({
      positionCode,
      title,
      departmentName,
      accountCode,
      startPeriodCode,
      endPeriodCode,
      fte: row.fte.trim(),
      annualSalary: row.annualSalary.trim(),
      burdenRate: row.burdenRate.trim(),
      bonusRate: row.bonusRate.trim(),
      rampFirstPeriodPct: row.rampFirstPeriodPct.trim(),
      meritPeriodCode,
      meritIncreasePct: row.meritIncreasePct.trim(),
      status: row.status,
    });
  }

  if (options?.allowEmpty !== true && draft.positions.length > 0 && activeCount === 0 && options?.requireScenarioName === true) {
    issues.push('NO_ACTIVE_POSITIONS: Set at least one position status to active before committing.');
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    scenarioName,
    scenarioKind: draft.scenarioKind,
    positions: built,
  };
}

export interface PvmItemDraft {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly planUnits: string;
  readonly planPrice: string;
  readonly actualUnits: string;
  readonly actualPrice: string;
}

const NON_NEGATIVE_DECIMAL_RE = /^\d+(?:\.\d{1,6})?$/;
const SIGNED_MONEY_DECIMAL_RE = /^-?\d+(?:\.\d{1,6})?$/;

export function createEmptyPvmItemDraft(id: string): PvmItemDraft {
  return {
    id,
    key: '',
    label: '',
    planUnits: '',
    planPrice: '',
    actualUnits: '',
    actualPrice: '',
  };
}

export type BuildPvmItemsResult =
  | { readonly ok: true; readonly items: readonly PvmBridgeItemInput[] }
  | { readonly ok: false; readonly issues: readonly string[] };

/**
 * Validates PVM bridge item rows strictly by decimal string shape without numeric conversion.
 * All PVM decomposition arithmetic and residual allocation run exclusively in /core/variance.
 */
export function buildPvmBridgeItemsPayload(
  rows: readonly PvmItemDraft[],
): BuildPvmItemsResult {
  const issues: string[] = [];
  if (rows.length === 0) {
    return {
      ok: false,
      issues: ['NO_PVM_ITEMS: Add at least one SKU or segment row before computing the PVM bridge.'],
    };
  }

  const seenKeys = new Set<string>();
  const built: PvmBridgeItemInput[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const labelPrefix = `Segment ${String(i + 1)}`;
    const key = row.key.trim().replace(/\s+/g, ' ');
    const label = row.label.trim();
    const planUnits = row.planUnits.trim();
    const planPrice = row.planPrice.trim();
    const actualUnits = row.actualUnits.trim();
    const actualPrice = row.actualPrice.trim();

    if (key.length === 0) {
      issues.push(`${labelPrefix}: segment key is required.`);
    } else if (seenKeys.has(key)) {
      issues.push(`DUPLICATE_ITEM_KEY:${key}`);
    } else {
      seenKeys.add(key);
    }

    if (label.length === 0) {
      issues.push(`${labelPrefix}: segment label is required.`);
    }
    if (!NON_NEGATIVE_DECIMAL_RE.test(planUnits)) {
      issues.push(`${labelPrefix}: plan units must be a non-negative decimal string (e.g. 100).`);
    }
    if (!SIGNED_MONEY_DECIMAL_RE.test(planPrice)) {
      issues.push(`${labelPrefix}: plan price must be a canonical decimal string (e.g. 10.00).`);
    }
    if (!NON_NEGATIVE_DECIMAL_RE.test(actualUnits)) {
      issues.push(`${labelPrefix}: actual units must be a non-negative decimal string (e.g. 120).`);
    }
    if (!SIGNED_MONEY_DECIMAL_RE.test(actualPrice)) {
      issues.push(`${labelPrefix}: actual price must be a canonical decimal string (e.g. 11.00).`);
    }

    if (
      key.length > 0 &&
      label.length > 0 &&
      NON_NEGATIVE_DECIMAL_RE.test(planUnits) &&
      SIGNED_MONEY_DECIMAL_RE.test(planPrice) &&
      NON_NEGATIVE_DECIMAL_RE.test(actualUnits) &&
      SIGNED_MONEY_DECIMAL_RE.test(actualPrice)
    ) {
      built.push({
        key,
        label,
        planUnits,
        planPrice,
        actualUnits,
        actualPrice,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, items: built };
}



