export interface WorkIntegrityMetrics {
  readonly testFiles: number;
  readonly testCases: number;
  readonly assertions: number;
  readonly suppressions: number;
  readonly placeholders: number;
}

export interface WorkIntegrityResult {
  readonly metrics: WorkIntegrityMetrics;
  readonly violations: readonly string[];
}

export function runWorkIntegrityCheck(
  rootDir?: string,
  options?: { readonly updateRatchet?: boolean },
): WorkIntegrityResult;
