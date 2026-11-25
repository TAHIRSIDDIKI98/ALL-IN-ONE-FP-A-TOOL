import type { DriverDefinitionInput, ScenarioKind, ScenarioSummary } from '../../shared/planning.js';

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

