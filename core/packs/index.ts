// Pure Data-Only Industry Pack validator and CoA compiler (MASTER_PROMPT §2.4, §6.6; WI-0039).
// Zero IO, zero framework imports, zero executable pack code allowed (no seed_sql / eval).

import {
  STATEMENT_LINE_MAP,
  expectedNormalSideForType,
  normalizeCode,
  type AccountType,
  type NormalSide,
} from '../statements/index.js';
import type { ChartCsvAccount } from '../chart/index.js';

export const PACK_SCHEMA_VERSION = '1.0.0' as const;
export const ALLOWED_PACK_CALENDARS = ['12month', '454', '445', '544', '3334'] as const;
export type PackCalendarKind = (typeof ALLOWED_PACK_CALENDARS)[number];

export const PACK_ACCOUNT_TYPES = [
  'revenue',
  'cogs',
  'opex',
  'asset',
  'liability',
  'equity',
] as const;
export type PackAccountType = (typeof PACK_ACCOUNT_TYPES)[number];

export interface RawPackManifest {
  readonly schema_version: string;
  readonly pack: {
    readonly key: string;
    readonly name: string;
    readonly version: string;
    readonly description: string;
    readonly default_calendar: string;
    readonly default_currency_hint: string;
    readonly locale_hint: string;
    readonly logo_ref?: string;
  };
  readonly coa_template: string;
  readonly kpi_definitions: string;
  readonly driver_templates: string;
  readonly report_layouts: string;
  readonly gl_template: string;
  readonly group_rollup_maps: string;
  readonly seed_sql?: string;
  readonly assets?: {
    readonly glossary?: string;
    readonly help_topics?: string;
  };
}

export interface RawPackCoaAccount {
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly section: string;
  readonly dimensions: readonly string[];
  readonly is_control: boolean;
}

export interface RawPackDriver {
  readonly key: string;
  readonly name: string;
  readonly type: string;
  readonly unit: string;
  readonly bounds: {
    readonly low: string | number;
    readonly high: string | number;
  };
  readonly default_method: string;
  readonly links: readonly string[];
}

export interface RawPackKpi {
  readonly key: string;
  readonly name: string;
  readonly unit: string;
  readonly formula: string;
  readonly target: {
    readonly value: string | number;
    readonly direction: string;
  };
  readonly definition: string;
  readonly bands: {
    readonly good: string | number;
    readonly watch: string | number;
  };
}

export interface RawPackLayoutColumn {
  readonly type: string;
  readonly compare?: string;
}

export interface RawPackLayout {
  readonly key: string;
  readonly name: string;
  readonly rows: readonly string[];
  readonly columns: readonly RawPackLayoutColumn[];
  readonly format?: Readonly<Record<string, unknown>>;
}

export interface RawPackBundle {
  readonly manifest: unknown;
  readonly coa: unknown;
  readonly drivers: unknown;
  readonly kpis: unknown;
  readonly layouts: unknown;
  readonly glTemplate: unknown;
  readonly rollup: unknown;
}

export interface CompiledPackAccount extends ChartCsvAccount {
  readonly packType: PackAccountType;
  readonly section: string;
  readonly isControl: boolean;
}

export interface ValidatedPackDriver {
  readonly key: string;
  readonly name: string;
  readonly type: string;
  readonly unit: string;
  readonly low: string;
  readonly high: string;
  readonly defaultMethod: string;
  readonly links: readonly string[];
}

export interface ValidatedPackKpi {
  readonly key: string;
  readonly name: string;
  readonly unit: string;
  readonly formula: string;
  readonly targetValue: string;
  readonly targetDirection: string;
  readonly definition: string;
  readonly goodThreshold: string;
  readonly watchThreshold: string;
}

export interface ValidatedPackLayout {
  readonly key: string;
  readonly name: string;
  readonly rows: readonly string[];
  readonly columns: readonly RawPackLayoutColumn[];
}

export interface ValidatedIndustryPack {
  readonly schemaVersion: '1.0.0';
  readonly key: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly defaultCalendar: PackCalendarKind;
  readonly defaultCurrencyHint: string;
  readonly localeHint: string;
  readonly dataOnly: true;
  readonly coaAccounts: readonly RawPackCoaAccount[];
  readonly drivers: readonly ValidatedPackDriver[];
  readonly kpis: readonly ValidatedPackKpi[];
  readonly layouts: readonly ValidatedPackLayout[];
}

export type PackValidationResult =
  | { readonly ok: true; readonly pack: ValidatedIndustryPack }
  | { readonly ok: false; readonly issues: readonly string[] };

const MANIFEST_ALLOWED_KEYS = new Set([
  'schema_version',
  'pack',
  'coa_template',
  'kpi_definitions',
  'driver_templates',
  'report_layouts',
  'gl_template',
  'group_rollup_maps',
  'seed_sql',
  'assets',
]);

const PACK_HEADER_ALLOWED_KEYS = new Set([
  'key',
  'name',
  'version',
  'description',
  'default_calendar',
  'default_currency_hint',
  'locale_hint',
  'logo_ref',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function scalarToCanonicalString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/**
 * Validates a raw data-only industry pack bundle against pack.schema.json constraints.
 * Rejects any executable `seed_sql` or dynamic code artifacts (`§2.4`, `B15`).
 */
export function validateIndustryPackBundle(raw: RawPackBundle): PackValidationResult {
  const issues: string[] = [];

  if (!isRecord(raw.manifest)) {
    return { ok: false, issues: ['PACK_SCHEMA_INVALID:manifest'] };
  }

  for (const key of Object.keys(raw.manifest)) {
    if (!MANIFEST_ALLOWED_KEYS.has(key)) {
      issues.push(`PACK_SCHEMA_INVALID:manifest.${key}`);
    }
  }

  if (raw.manifest['seed_sql'] !== undefined) {
    issues.push('PACK_EXECUTABLE_DISALLOWED:manifest.seed_sql');
  }

  if (raw.manifest['schema_version'] !== PACK_SCHEMA_VERSION) {
    issues.push('PACK_SCHEMA_INVALID:manifest.schema_version');
  }

  const requiredStringFields = [
    'coa_template',
    'kpi_definitions',
    'driver_templates',
    'report_layouts',
    'gl_template',
    'group_rollup_maps',
  ] as const;
  for (const field of requiredStringFields) {
    if (asNonEmptyString(raw.manifest[field]) === null) {
      issues.push(`PACK_SCHEMA_INVALID:manifest.${field}`);
    }
  }

  const packObj = raw.manifest['pack'];
  let packKey = '';
  let packName = '';
  let packVersion = '';
  let packDesc = '';
  let packCalendar: PackCalendarKind = '12month';
  let packCurrency = 'USD';
  let packLocale = 'en-US';

  if (!isRecord(packObj)) {
    issues.push('PACK_SCHEMA_INVALID:manifest.pack');
  } else {
    for (const k of Object.keys(packObj)) {
      if (!PACK_HEADER_ALLOWED_KEYS.has(k)) {
        issues.push(`PACK_SCHEMA_INVALID:manifest.pack.${k}`);
      }
    }
    const rawKey = packObj['key'];
    if (typeof rawKey !== 'string' || !/^[a-z][a-z_-]+$/.test(rawKey)) {
      issues.push('PACK_SCHEMA_INVALID:manifest.pack.key');
    } else {
      packKey = rawKey;
    }

    const rawName = packObj['name'];
    if (typeof rawName !== 'string' || rawName.trim().length < 2) {
      issues.push('PACK_SCHEMA_INVALID:manifest.pack.name');
    } else {
      packName = rawName.trim();
    }

    const rawVer = packObj['version'];
    if (typeof rawVer !== 'string' || !/^\d+\.\d+\.\d+$/.test(rawVer)) {
      issues.push('PACK_SCHEMA_INVALID:manifest.pack.version');
    } else {
      packVersion = rawVer;
    }

    const rawDesc = packObj['description'];
    if (typeof rawDesc !== 'string' || rawDesc.trim().length < 10) {
      issues.push('PACK_SCHEMA_INVALID:manifest.pack.description');
    } else {
      packDesc = rawDesc.trim();
    }

    const rawCal = packObj['default_calendar'];
    if (typeof rawCal !== 'string' || !ALLOWED_PACK_CALENDARS.includes(rawCal as PackCalendarKind)) {
      issues.push('PACK_SCHEMA_INVALID:manifest.pack.default_calendar');
    } else {
      packCalendar = rawCal as PackCalendarKind;
    }

    const rawCur = packObj['default_currency_hint'];
    if (typeof rawCur !== 'string' || !/^[A-Z]{3}$/.test(rawCur)) {
      issues.push('PACK_SCHEMA_INVALID:manifest.pack.default_currency_hint');
    } else {
      packCurrency = rawCur;
    }

    const rawLoc = packObj['locale_hint'];
    if (typeof rawLoc !== 'string' || !/^[a-z]{2}-[A-Z]{2}$/.test(rawLoc)) {
      issues.push('PACK_SCHEMA_INVALID:manifest.pack.locale_hint');
    } else {
      packLocale = rawLoc;
    }
  }

  // Validate CoA accounts
  const coaAccounts: RawPackCoaAccount[] = [];
  if (!isRecord(raw.coa) || !Array.isArray(raw.coa['accounts']) || raw.coa['accounts'].length === 0) {
    issues.push('PACK_SCHEMA_INVALID:coa.accounts');
  } else {
    const seenCodes = new Set<string>();
    raw.coa['accounts'].forEach((entry, idx) => {
      if (!isRecord(entry)) {
        issues.push(`PACK_SCHEMA_INVALID:coa.accounts[${idx}]`);
        return;
      }
      const rawCode = entry['code'];
      let code: string | null = null;
      if (typeof rawCode !== 'string' || rawCode.trim().length === 0) {
        issues.push(`PACK_SCHEMA_INVALID:coa.accounts[${idx}].code`);
      } else {
        try {
          code = normalizeCode(rawCode);
        } catch {
          issues.push(`PACK_SCHEMA_INVALID:coa.accounts[${idx}].code`);
        }
      }
      if (code !== null) {
        if (seenCodes.has(code)) {
          issues.push(`PACK_DUPLICATE_ACCOUNT_CODE:${code}`);
        } else {
          seenCodes.add(code);
        }
      }

      const name = asNonEmptyString(entry['name']);
      if (name === null) {
        issues.push(`PACK_SCHEMA_INVALID:coa.accounts[${idx}].name`);
      }

      const rawType = typeof entry['type'] === 'string' ? entry['type'].toLowerCase() : '';
      if (!PACK_ACCOUNT_TYPES.includes(rawType as PackAccountType)) {
        issues.push(`PACK_SCHEMA_INVALID:coa.accounts[${idx}].type`);
      }

      const section = asNonEmptyString(entry['section']);
      if (section === null) {
        issues.push(`PACK_SCHEMA_INVALID:coa.accounts[${idx}].section`);
      }

      const dimensionsRaw = entry['dimensions'];
      const dimensions =
        Array.isArray(dimensionsRaw) && dimensionsRaw.every((d) => typeof d === 'string')
          ? (dimensionsRaw as readonly string[])
          : null;
      if (dimensions === null) {
        issues.push(`PACK_SCHEMA_INVALID:coa.accounts[${idx}].dimensions`);
      }

      const isControl = entry['is_control'];
      if (typeof isControl !== 'boolean') {
        issues.push(`PACK_SCHEMA_INVALID:coa.accounts[${idx}].is_control`);
      }

      if (
        code !== null &&
        name !== null &&
        section !== null &&
        dimensions !== null &&
        typeof isControl === 'boolean' &&
        PACK_ACCOUNT_TYPES.includes(rawType as PackAccountType)
      ) {
        coaAccounts.push({
          code,
          name,
          type: rawType,
          section,
          dimensions,
          is_control: isControl,
        });
      }
    });
  }

  // Validate drivers
  const drivers: ValidatedPackDriver[] = [];
  if (!isRecord(raw.drivers) || !Array.isArray(raw.drivers['drivers']) || raw.drivers['drivers'].length === 0) {
    issues.push('PACK_SCHEMA_INVALID:drivers.drivers');
  } else {
    raw.drivers['drivers'].forEach((entry, idx) => {
      if (!isRecord(entry)) {
        issues.push(`PACK_SCHEMA_INVALID:drivers.drivers[${idx}]`);
        return;
      }
      const key = asNonEmptyString(entry['key']);
      const name = asNonEmptyString(entry['name']);
      const type = asNonEmptyString(entry['type']);
      const unit = asNonEmptyString(entry['unit']);
      const defaultMethod = asNonEmptyString(entry['default_method']);
      const bounds = isRecord(entry['bounds']) ? entry['bounds'] : null;
      const low = bounds ? scalarToCanonicalString(bounds['low']) : null;
      const high = bounds ? scalarToCanonicalString(bounds['high']) : null;
      const links =
        Array.isArray(entry['links']) && entry['links'].every((l) => typeof l === 'string')
          ? (entry['links'] as readonly string[])
          : null;

      if (!key || !name || !type || !unit || !defaultMethod || !low || !high || !links) {
        issues.push(`PACK_SCHEMA_INVALID:drivers.drivers[${idx}]`);
        return;
      }
      drivers.push({ key, name, type, unit, low, high, defaultMethod, links });
    });
  }

  // Validate KPIs
  const kpis: ValidatedPackKpi[] = [];
  if (!isRecord(raw.kpis) || !Array.isArray(raw.kpis['kpis']) || raw.kpis['kpis'].length === 0) {
    issues.push('PACK_SCHEMA_INVALID:kpis.kpis');
  } else {
    raw.kpis['kpis'].forEach((entry, idx) => {
      if (!isRecord(entry)) {
        issues.push(`PACK_SCHEMA_INVALID:kpis.kpis[${idx}]`);
        return;
      }
      const key = asNonEmptyString(entry['key']);
      const name = asNonEmptyString(entry['name']);
      const unit = asNonEmptyString(entry['unit']);
      const formula = asNonEmptyString(entry['formula']);
      const definition = asNonEmptyString(entry['definition']);
      const target = isRecord(entry['target']) ? entry['target'] : null;
      const targetValue = target ? scalarToCanonicalString(target['value']) : null;
      const targetDirection = target ? asNonEmptyString(target['direction']) : null;
      const bands = isRecord(entry['bands']) ? entry['bands'] : null;
      const goodThreshold = bands ? scalarToCanonicalString(bands['good']) : null;
      const watchThreshold = bands ? scalarToCanonicalString(bands['watch']) : null;

      if (
        !key ||
        !name ||
        !unit ||
        !formula ||
        !definition ||
        !targetValue ||
        !targetDirection ||
        !goodThreshold ||
        !watchThreshold
      ) {
        issues.push(`PACK_SCHEMA_INVALID:kpis.kpis[${idx}]`);
        return;
      }
      kpis.push({
        key,
        name,
        unit,
        formula,
        targetValue,
        targetDirection,
        definition,
        goodThreshold,
        watchThreshold,
      });
    });
  }

  // Validate report layouts
  const layouts: ValidatedPackLayout[] = [];
  if (!isRecord(raw.layouts) || !Array.isArray(raw.layouts['layouts']) || raw.layouts['layouts'].length === 0) {
    issues.push('PACK_SCHEMA_INVALID:layouts.layouts');
  } else {
    raw.layouts['layouts'].forEach((entry, idx) => {
      if (!isRecord(entry)) {
        issues.push(`PACK_SCHEMA_INVALID:layouts.layouts[${idx}]`);
        return;
      }
      const key = asNonEmptyString(entry['key']);
      const name = asNonEmptyString(entry['name']);
      const rows =
        Array.isArray(entry['rows']) && entry['rows'].every((r) => typeof r === 'string')
          ? (entry['rows'] as readonly string[])
          : null;
      const colsRaw = entry['columns'];
      const columns: RawPackLayoutColumn[] = [];
      let colsValid = Array.isArray(colsRaw) && colsRaw.length > 0;
      if (Array.isArray(colsRaw)) {
        for (const col of colsRaw) {
          if (!isRecord(col) || asNonEmptyString(col['type']) === null) {
            colsValid = false;
          } else {
            const colType = asNonEmptyString(col['type'])!;
            const compare = asNonEmptyString(col['compare']);
            columns.push(compare ? { type: colType, compare } : { type: colType });
          }
        }
      }
      if (!key || !name || !rows || rows.length === 0 || !colsValid) {
        issues.push(`PACK_SCHEMA_INVALID:layouts.layouts[${idx}]`);
        return;
      }
      layouts.push({ key, name, rows, columns });
    });
  }

  // Validate gl_template & rollup structure
  if (!isRecord(raw.glTemplate) || !isRecord(raw.glTemplate['columns'])) {
    issues.push('PACK_SCHEMA_INVALID:gl_template.columns');
  }
  if (!isRecord(raw.rollup) || !Array.isArray(raw.rollup['maps']) || asNonEmptyString(raw.rollup['default_currency']) === null) {
    issues.push('PACK_SCHEMA_INVALID:rollup');
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    pack: {
      schemaVersion: PACK_SCHEMA_VERSION,
      key: packKey,
      name: packName,
      version: packVersion,
      description: packDesc,
      defaultCalendar: packCalendar,
      defaultCurrencyHint: packCurrency,
      localeHint: packLocale,
      dataOnly: true,
      coaAccounts,
      drivers,
      kpis,
      layouts,
    },
  };
}

function mapPackAccountTypeToCanonical(packType: PackAccountType): AccountType {
  if (packType === 'cogs' || packType === 'opex') return 'expense';
  return packType;
}

function inferStatementLineKey(account: RawPackCoaAccount): string {
  const packType = account.type as PackAccountType;
  const code = normalizeCode(account.code);
  const lowerName = account.name.toLowerCase();

  if (packType === 'revenue') {
    if (lowerName.includes('service')) return 'pl.revenue.service';
    if (code === '4000' || lowerName.includes('subscription') || lowerName.includes('sales')) {
      return 'pl.revenue.product';
    }
    return 'pl.revenue.other';
  }

  if (packType === 'cogs') {
    if (lowerName.includes('shrink') || lowerName.includes('overhead')) {
      return 'pl.cogs.other';
    }
    return 'pl.cogs.direct';
  }

  if (packType === 'opex') {
    if (lowerName.includes('r&d') || lowerName.includes('research')) return 'pl.opex.rd';
    if (lowerName.includes('s&m') || lowerName.includes('marketing') || lowerName.includes('sales')) {
      return 'pl.opex.sm';
    }
    if (lowerName.includes('g&a') || lowerName.includes('general')) return 'pl.opex.ga';
    if (lowerName.includes('payroll') || lowerName.includes('salar') || lowerName.includes('wage')) {
      return 'pl.opex.payroll';
    }
    return 'pl.opex.other';
  }

  if (packType === 'asset') {
    if (code === '1000' || lowerName.includes('cash')) return 'bs.asset.cash';
    if (code === '1200' || lowerName.includes('receivable')) return 'bs.asset.ar';
    if (code === '1300' || lowerName.includes('inventory')) return 'bs.asset.inventory';
    return 'bs.asset.other_current';
  }

  if (packType === 'liability') {
    if (code === '2300' || lowerName.includes('deferred')) return 'bs.liability.deferred_rev';
    if (code === '2000' || lowerName.includes('payable')) return 'bs.liability.ap';
    return 'bs.liability.accrued';
  }

  return 'bs.equity.common_stock';
}

/**
 * Compiles validated data-only Q2 pack CoA entries onto OneFP&A canonical chart rows.
 * All accounts compile with explicit STATEMENT_LINE_MAP keys and `isPostable: true`.
 */
export function compilePackToChartAccounts(
  pack: ValidatedIndustryPack,
): readonly CompiledPackAccount[] {
  return pack.coaAccounts.map((entry) => {
    const packType = entry.type as PackAccountType;
    const type = mapPackAccountTypeToCanonical(packType);
    const normalSide: NormalSide = expectedNormalSideForType(type);
    const statementLineKey = inferStatementLineKey(entry);
    if (!STATEMENT_LINE_MAP.has(statementLineKey)) {
      throw new Error(`PACK_STATEMENT_LINE_UNKNOWN:${statementLineKey}`);
    }
    return {
      code: normalizeCode(entry.code),
      name: entry.name,
      type,
      normalSide,
      parentCode: null,
      isPostable: true,
      statementLineKey,
      packType,
      section: entry.section,
      isControl: entry.is_control,
    };
  });
}
