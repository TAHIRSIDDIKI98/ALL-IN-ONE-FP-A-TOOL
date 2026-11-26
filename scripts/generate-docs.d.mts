export function checkOrWriteUserGuide(
  rootDir?: string,
  mode?: 'check' | 'write',
): {
  readonly ok: boolean;
  readonly drifts: readonly string[];
  readonly specSha: string;
  readonly sectionCount: number;
  readonly written: number;
};
