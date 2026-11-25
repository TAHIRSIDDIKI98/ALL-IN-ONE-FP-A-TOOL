import type { ScenarioSummary } from '../../shared/planning.js';

/**
 * Pure selection rules for the planning view (WI-0032). Extracted from the React page so the
 * fallback behaviour — which scenario a fresh forecast opens on, which two scenarios a comparison
 * starts with — is decided in ONE testable place instead of inside an effect.
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
