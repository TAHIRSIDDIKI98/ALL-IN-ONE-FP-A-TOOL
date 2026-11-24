// Ported from fpa/src-tauri/src/core/calendar.rs @ 6f6f72f5b681 and cross-checked with fp-A-betterversion/src/utils/fiscalPeriods.ts @ 86d785ca696c. Class B.
// Changes: Implemented pure UTC calendar arithmetic in TypeScript with zero external IO/date libraries; supports 12month, 445, 454, 544, 52_53, 13x4 (3-3-3-4), optional period-13 adjustment period, date->period resolution, and YTD/QTD/TTM period slicing with partial-basis disclosure (MASTER_PROMPT §4.6, §5.8 E9). Oracle: fixtures/oracles/calendar/*.json.

export type CalendarKind = '12month' | '445' | '454' | '544' | '52_53' | '13x4';
export type Week53Rule = 'nrf4day' | 'fullweek';

export interface GeneratedPeriod {
  readonly fiscalYear: number;
  readonly fyLabel: string;
  readonly periodNo: number;
  readonly code: string;
  readonly label: string;
  readonly quarter: 1 | 2 | 3 | 4;
  readonly startDate: string;
  readonly endDate: string;
  readonly is53rdWeek: boolean;
  readonly isAdjustment: boolean;
}

export interface GeneratedFiscalYear {
  readonly fiscalYear: number;
  readonly fyLabel: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly weekCount: 52 | 53;
  readonly periods: readonly GeneratedPeriod[];
}

export interface CalendarGenerateOptions {
  readonly kind: CalendarKind;
  readonly startYear: number;
  readonly yearCount?: number;
  readonly startMonth?: number; // 1..12, default 1 for 12month, 2 (Feb NRF) for week-based
  readonly week53Rule?: Week53Rule;
  readonly includeAdjustmentPeriod?: boolean;
}

const MS_PER_DAY = 86_400_000;

function parseIsoDateUtc(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) {
    throw new Error(`INVALID_ISO_DATE: "${iso}"`);
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ts = Date.UTC(y, mo - 1, d);
  const dt = new Date(ts);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new Error(`NONEXISTENT_ISO_DATE: "${iso}"`);
  }
  return ts;
}

function formatIsoDateUtc(ts: number): string {
  const dt = new Date(ts);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysUtc(ts: number, days: number): number {
  return ts + days * MS_PER_DAY;
}

/**
 * NRF Sunday nearest to the 1st of the anchor month:
 * Sun (0) -> same day; Mon..Wed (1..3) -> previous Sunday; Thu..Sat (4..6) -> following Sunday.
 */
export function sundayNearest(isoDate: string): string {
  const ts = parseIsoDateUtc(isoDate);
  const dow = new Date(ts).getUTCDay(); // 0=Sun..6=Sat
  if (dow === 0) return formatIsoDateUtc(ts);
  if (dow <= 3) return formatIsoDateUtc(addDaysUtc(ts, -dow));
  return formatIsoDateUtc(addDaysUtc(ts, 7 - dow));
}

function lastDayOfMonthUtc(year: number, month1Based: number): number {
  return Date.UTC(year, month1Based, 0);
}

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export function build12MonthYears(
  startYear: number,
  startMonth = 1,
  yearCount = 1,
  includeAdjustmentPeriod = false,
): GeneratedFiscalYear[] {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new Error(`INVALID_START_MONTH: ${String(startMonth)}`);
  }
  if (!Number.isInteger(yearCount) || yearCount < 1) {
    throw new Error(`INVALID_YEAR_COUNT: ${String(yearCount)}`);
  }

  const years: GeneratedFiscalYear[] = [];

  for (let yi = 0; yi < yearCount; yi++) {
    const fy = startYear + yi;
    const fyLabel = `FY${fy}`;
    const periods: GeneratedPeriod[] = [];

    for (let p = 0; p < 12; p++) {
      const zeroMonth = startMonth - 1 + p;
      const calYear = fy + Math.floor(zeroMonth / 12);
      const calMonth1 = (zeroMonth % 12) + 1;
      const startTs = Date.UTC(calYear, calMonth1 - 1, 1);
      const endTs = lastDayOfMonthUtc(calYear, calMonth1);
      const periodNo = p + 1;
      const code = `P${String(periodNo).padStart(2, '0')}`;
      const quarter = (Math.floor(p / 3) + 1) as 1 | 2 | 3 | 4;
      const monthLabel = SHORT_MONTHS[calMonth1 - 1] ?? code;
      periods.push({
        fiscalYear: fy,
        fyLabel,
        periodNo,
        code,
        label: `${code} (${monthLabel} ${calYear})`,
        quarter,
        startDate: formatIsoDateUtc(startTs),
        endDate: formatIsoDateUtc(endTs),
        is53rdWeek: false,
        isAdjustment: false,
      });
    }

    const firstStart = periods[0]!.startDate;
    const lastRegularEnd = periods[11]!.endDate;

    if (includeAdjustmentPeriod) {
      periods.push({
        fiscalYear: fy,
        fyLabel,
        periodNo: 13,
        code: 'P13',
        label: `P13 (Adj ${fyLabel})`,
        quarter: 4,
        startDate: lastRegularEnd,
        endDate: lastRegularEnd,
        is53rdWeek: false,
        isAdjustment: true,
      });
    }

    years.push({
      fiscalYear: fy,
      fyLabel,
      startDate: firstStart,
      endDate: lastRegularEnd,
      weekCount: 52,
      periods,
    });
  }

  return years;
}

function weekScheduleForKind(
  kind: Exclude<CalendarKind, '12month'>,
  weekCount: 52 | 53,
  week53Rule: Week53Rule,
): { weeks: number[]; flags: boolean[]; quarters: (1 | 2 | 3 | 4)[]; appendStandaloneW53: boolean } {
  if (kind === '13x4') {
    const weeks = Array.from({ length: 13 }, () => 4);
    const flags = Array.from({ length: 13 }, () => false);
    const quarters: (1 | 2 | 3 | 4)[] = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4];
    if (weekCount === 53) {
      weeks[12] = 5;
      flags[12] = true;
    }
    return { weeks, flags, quarters, appendStandaloneW53: false };
  }

  // 52_53 defaults to NRF 4-5-4 pattern with declared week53Rule
  const effectiveKind = kind === '52_53' ? '454' : kind;

  if (effectiveKind === '454') {
    const q4 = weekCount === 53 && week53Rule === 'nrf4day' ? [4, 5, 5] : [4, 5, 4];
    const weeks = [4, 5, 4, 4, 5, 4, 4, 5, 4, ...q4];
    const flags = Array.from({ length: 12 }, () => false);
    if (weekCount === 53 && week53Rule === 'nrf4day') {
      flags[11] = true;
    }
    const quarters: (1 | 2 | 3 | 4)[] = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4];
    const appendStandaloneW53 = weekCount === 53 && week53Rule === 'fullweek';
    return { weeks, flags, quarters, appendStandaloneW53 };
  }

  // 4-4-5 and 5-4-4: NRF 4-day absorption is exclusive to 4-5-4; 53-week years append explicit W53
  const qPattern = effectiveKind === '445' ? [4, 4, 5] : [5, 4, 4];
  const weeks = [...qPattern, ...qPattern, ...qPattern, ...qPattern];
  const flags = Array.from({ length: 12 }, () => false);
  const quarters: (1 | 2 | 3 | 4)[] = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4];
  return {
    weeks,
    flags,
    quarters,
    appendStandaloneW53: weekCount === 53,
  };
}

export function generateFiscalYears(options: CalendarGenerateOptions): GeneratedFiscalYear[] {
  const yearCount = options.yearCount ?? 1;
  if (options.kind === '12month') {
    return build12MonthYears(
      options.startYear,
      options.startMonth ?? 1,
      yearCount,
      options.includeAdjustmentPeriod ?? false,
    );
  }

  const anchorMonth = options.startMonth ?? 2; // NRF standard February anchor
  const week53Rule = options.week53Rule ?? 'nrf4day';
  let cursorIso = sundayNearest(
    `${options.startYear}-${String(anchorMonth).padStart(2, '0')}-01`,
  );

  const years: GeneratedFiscalYear[] = [];

  for (let yi = 0; yi < yearCount; yi++) {
    const startTs = parseIsoDateUtc(cursorIso);
    const anchorCalYear = options.startYear + yi;
    const nextAnchorIso = sundayNearest(
      `${anchorCalYear + 1}-${String(anchorMonth).padStart(2, '0')}-01`,
    );
    const nextStartTs = parseIsoDateUtc(nextAnchorIso);
    const totalDays = Math.round((nextStartTs - startTs) / MS_PER_DAY);
    const weekCount: 52 | 53 = totalDays >= 371 ? 53 : 52;
    const endTs = addDaysUtc(nextStartTs, -1);

    const schedule = weekScheduleForKind(options.kind, weekCount, week53Rule);
    const weeks = [...schedule.weeks];
    const flags = [...schedule.flags];
    const quarters = [...schedule.quarters];

    if (schedule.appendStandaloneW53) {
      weeks.push(1);
      flags.push(true);
      quarters.push(4);
    }

    const fyLabel = `FY${anchorCalYear}`;
    const periods: GeneratedPeriod[] = [];
    let dayCursor = startTs;

    for (let i = 0; i < weeks.length; i++) {
      const w = weeks[i]!;
      const pStart = dayCursor;
      const pEnd = addDaysUtc(pStart, w * 7 - 1);
      dayCursor = addDaysUtc(pEnd, 1);
      const isW53Standalone = schedule.appendStandaloneW53 && i === weeks.length - 1;
      const periodNo = i + 1;
      const code = isW53Standalone ? 'W53' : `P${String(periodNo).padStart(2, '0')}`;
      periods.push({
        fiscalYear: anchorCalYear,
        fyLabel,
        periodNo,
        code,
        label: `${fyLabel} ${code}`,
        quarter: quarters[i] ?? 4,
        startDate: formatIsoDateUtc(pStart),
        endDate: formatIsoDateUtc(pEnd),
        is53rdWeek: flags[i] ?? false,
        isAdjustment: false,
      });
    }

    if (options.includeAdjustmentPeriod) {
      const endIso = formatIsoDateUtc(endTs);
      periods.push({
        fiscalYear: anchorCalYear,
        fyLabel,
        periodNo: periods.length + 1,
        code: `P${String(periods.length + 1).padStart(2, '0')}`,
        label: `${fyLabel} Adj`,
        quarter: 4,
        startDate: endIso,
        endDate: endIso,
        is53rdWeek: false,
        isAdjustment: true,
      });
    }

    years.push({
      fiscalYear: anchorCalYear,
      fyLabel,
      startDate: formatIsoDateUtc(startTs),
      endDate: formatIsoDateUtc(endTs),
      weekCount,
      periods,
    });

    cursorIso = nextAnchorIso;
  }

  return years;
}

export function resolvePeriodForDate(
  periods: readonly GeneratedPeriod[],
  isoDate: string,
): GeneratedPeriod | null {
  const ts = parseIsoDateUtc(isoDate);
  for (const p of periods) {
    if (p.isAdjustment) continue;
    const s = parseIsoDateUtc(p.startDate);
    const e = parseIsoDateUtc(p.endDate);
    if (ts >= s && ts <= e) {
      return p;
    }
  }
  return null;
}

/**
 * Monthly views exclude adjustment periods (§5.8).
 */
export function selectMonthlyViewPeriods(periods: readonly GeneratedPeriod[]): GeneratedPeriod[] {
  return periods.filter((p) => !p.isAdjustment);
}

/**
 * YTD = sum of periods from fiscal year start through selected period.
 * Adjustment period is included ONLY when explicitly selected or includeAdjustments=true (§5.8).
 */
export function selectYtdPeriods(
  periods: readonly GeneratedPeriod[],
  selectedCode: string,
  includeAdjustments = false,
): { readonly periods: GeneratedPeriod[]; readonly basisLabel: string } {
  const selected = periods.find((p) => p.code === selectedCode);
  if (!selected) {
    throw new Error(`PERIOD_NOT_FOUND: "${selectedCode}"`);
  }
  const sameYear = periods.filter(
    (p) =>
      p.fiscalYear === selected.fiscalYear &&
      p.periodNo <= selected.periodNo &&
      (!p.isAdjustment || includeAdjustments || p.code === selectedCode),
  );
  const firstCode = sameYear[0]?.code ?? selectedCode;
  const adjNote = sameYear.some((p) => p.isAdjustment) ? 'incl. adjustment' : 'excl. adjustment';
  return {
    periods: sameYear,
    basisLabel: `YTD ${firstCode}–${selected.code}, ${adjNote}`,
  };
}

export function selectQtdPeriods(
  periods: readonly GeneratedPeriod[],
  selectedCode: string,
): { readonly periods: GeneratedPeriod[]; readonly basisLabel: string } {
  const selected = periods.find((p) => p.code === selectedCode);
  if (!selected) {
    throw new Error(`PERIOD_NOT_FOUND: "${selectedCode}"`);
  }
  const inQuarter = periods.filter(
    (p) =>
      p.fiscalYear === selected.fiscalYear &&
      p.quarter === selected.quarter &&
      p.periodNo <= selected.periodNo &&
      (!p.isAdjustment || p.code === selectedCode),
  );
  return {
    periods: inQuarter,
    basisLabel: `QTD Q${selected.quarter} through ${selected.code}`,
  };
}

/**
 * TTM = trailing 12 regular periods ending at `selectedCode`; if fewer than 12
 * periods exist, discloses partial basis explicitly (§5.8).
 */
export function selectTtmPeriods(
  allChronologicalPeriods: readonly GeneratedPeriod[],
  selectedFyLabel: string,
  selectedCode: string,
): {
  readonly periods: GeneratedPeriod[];
  readonly isPartial: boolean;
  readonly basisLabel: string;
} {
  const regular = allChronologicalPeriods.filter((p) => !p.isAdjustment && p.code !== 'W53');
  const idx = regular.findIndex(
    (p) => p.fyLabel === selectedFyLabel && p.code === selectedCode,
  );
  if (idx === -1) {
    throw new Error(`PERIOD_NOT_FOUND: ${selectedFyLabel} ${selectedCode}`);
  }
  const startIdx = Math.max(0, idx - 11);
  const slice = regular.slice(startIdx, idx + 1);
  const isPartial = slice.length < 12;
  const first = slice[0]!;
  const last = slice[slice.length - 1]!;
  return {
    periods: slice,
    isPartial,
    basisLabel: isPartial
      ? `Partial TTM (${slice.length}/12 periods populated: ${first.fyLabel} ${first.code}–${last.fyLabel} ${last.code})`
      : `TTM (${first.fyLabel} ${first.code}–${last.fyLabel} ${last.code})`,
  };
}
