import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compilePackToChartAccounts,
  validateIndustryPackBundle,
  type RawPackBundle,
} from '../../../core/packs/index.js';
import { canActorCreateTask } from '../../../core/workflow/index.js';
import type { ChartAccountRow } from '../../../shared/chart.js';
import { AppError } from '../../../shared/errors.js';
import {
  M2_INDUSTRY_PACK_KEYS,
  type ApplyIndustryPackResponse,
  type IndustryPackDetail,
  type IndustryPackKey,
} from '../../../shared/packs.js';
import { appendAuditLog } from '../../audit/index.js';
import type { SqlExecutor } from '../migrate.js';
import { listChartAccounts } from './chart.js';
import { seedChartOfAccounts } from './import.js';
import { getMemberRole } from './workflow.js';

interface PackChecksumsManifest {
  readonly files: Readonly<Record<string, string>>;
}

interface VerifiedPackEntry {
  readonly detail: IndustryPackDetail;
  readonly compiledAccounts: ReturnType<typeof compilePackToChartAccounts>;
}

let cachedM2Packs: readonly VerifiedPackEntry[] | null = null;

function readVerifiedJsonFile(
  packsRoot: string,
  relPath: string,
  expectedSha256: string | undefined,
): { readonly parsed: unknown; readonly sha256: string } {
  if (!expectedSha256) {
    throw new AppError('INTERNAL_ERROR', {
      userMessage: `Missing checksum entry for industry pack file "${relPath}".`,
    });
  }
  const fullPath = join(packsRoot, relPath);
  const bytes = readFileSync(fullPath);
  const actualSha = createHash('sha256').update(bytes).digest('hex');
  if (actualSha !== expectedSha256) {
    throw new AppError('INTERNAL_ERROR', {
      userMessage: `Industry pack integrity check failed for "${relPath}".`,
    });
  }
  return {
    parsed: JSON.parse(bytes.toString('utf8')) as unknown,
    sha256: actualSha,
  };
}

function loadVerifiedM2Packs(): readonly VerifiedPackEntry[] {
  if (cachedM2Packs !== null) {
    return cachedM2Packs;
  }
  const packsRoot = join(process.cwd(), 'fixtures', 'packs');
  const checksumManifest = JSON.parse(
    readFileSync(join(packsRoot, 'CHECKSUMS.json'), 'utf8'),
  ) as PackChecksumsManifest;

  const entries: VerifiedPackEntry[] = [];
  for (const packKey of M2_INDUSTRY_PACK_KEYS) {
    const manifestFile = readVerifiedJsonFile(
      packsRoot,
      `${packKey}/pack.json`,
      checksumManifest.files[`${packKey}/pack.json`],
    );
    const coaFile = readVerifiedJsonFile(
      packsRoot,
      `${packKey}/coa.json`,
      checksumManifest.files[`${packKey}/coa.json`],
    );
    const driversFile = readVerifiedJsonFile(
      packsRoot,
      `${packKey}/drivers.json`,
      checksumManifest.files[`${packKey}/drivers.json`],
    );
    const kpisFile = readVerifiedJsonFile(
      packsRoot,
      `${packKey}/kpis.json`,
      checksumManifest.files[`${packKey}/kpis.json`],
    );
    const layoutsFile = readVerifiedJsonFile(
      packsRoot,
      `${packKey}/layouts.json`,
      checksumManifest.files[`${packKey}/layouts.json`],
    );
    const glTemplateFile = readVerifiedJsonFile(
      packsRoot,
      `${packKey}/gl_template.json`,
      checksumManifest.files[`${packKey}/gl_template.json`],
    );
    const rollupFile = readVerifiedJsonFile(
      packsRoot,
      `${packKey}/rollup.json`,
      checksumManifest.files[`${packKey}/rollup.json`],
    );

    const rawBundle: RawPackBundle = {
      manifest: manifestFile.parsed,
      coa: coaFile.parsed,
      drivers: driversFile.parsed,
      kpis: kpisFile.parsed,
      layouts: layoutsFile.parsed,
      glTemplate: glTemplateFile.parsed,
      rollup: rollupFile.parsed,
    };

    const validation = validateIndustryPackBundle(rawBundle);
    if (!validation.ok) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Industry pack "${packKey}" failed schema validation.`,
        details: { issues: [...validation.issues] },
      });
    }

    const compiledAccounts = compilePackToChartAccounts(validation.pack);
    const detail: IndustryPackDetail = {
      key: packKey,
      name: validation.pack.name,
      version: validation.pack.version,
      description: validation.pack.description,
      defaultCalendar: validation.pack.defaultCalendar,
      defaultCurrencyHint: validation.pack.defaultCurrencyHint,
      localeHint: validation.pack.localeHint,
      dataOnly: true,
      sha256ManifestHash: manifestFile.sha256,
      accounts: compiledAccounts.map((account) => ({
        code: account.code,
        name: account.name,
        packType: account.packType,
        section: account.section,
        type: account.type,
        normalSide: account.normalSide,
        statementLineKey: account.statementLineKey as ChartAccountRow['statementLineKey'],
        isControl: account.isControl,
        isPostable: account.isPostable,
      })),
      drivers: validation.pack.drivers.map((d) => ({
        key: d.key,
        name: d.name,
        type: d.type,
        unit: d.unit,
        low: d.low,
        high: d.high,
        defaultMethod: d.defaultMethod,
        links: [...d.links],
      })),
      kpis: validation.pack.kpis.map((k) => ({
        key: k.key,
        name: k.name,
        unit: k.unit,
        formula: k.formula,
        targetValue: k.targetValue,
        targetDirection: k.targetDirection,
        definition: k.definition,
        goodThreshold: k.goodThreshold,
        watchThreshold: k.watchThreshold,
      })),
      layouts: validation.pack.layouts.map((l) => ({
        key: l.key,
        name: l.name,
        rows: [...l.rows],
        columns: l.columns.map((c) => ({
          type: c.type,
          ...(c.compare === undefined ? {} : { compare: c.compare }),
        })),
      })),
    };
    entries.push({ detail, compiledAccounts });
  }

  cachedM2Packs = entries;
  return entries;
}

export function listIndustryPacks(): readonly IndustryPackDetail[] {
  return loadVerifiedM2Packs().map((entry) => entry.detail);
}

export interface ApplyIndustryPackParams {
  readonly companyId: string;
  readonly actorId: string;
  readonly packKey: IndustryPackKey;
  readonly occurredAt: string;
}

export async function applyIndustryPackToCompany(
  tx: SqlExecutor,
  params: ApplyIndustryPackParams,
): Promise<ApplyIndustryPackResponse> {
  const role = await getMemberRole(tx, params.companyId, params.actorId);
  if (role === null || !canActorCreateTask(role)) {
    throw new AppError('TENANT_FORBIDDEN', {
      userMessage: 'Only workspace owners or editors can apply an industry pack chart.',
    });
  }

  const packEntry = loadVerifiedM2Packs().find((entry) => entry.detail.key === params.packKey);
  if (packEntry === undefined) {
    throw new AppError('NOT_FOUND', {
      userMessage: `Industry pack "${params.packKey}" is not available in this milestone.`,
    });
  }

  const { inserted, updated } = await seedChartOfAccounts(tx, {
    companyId: params.companyId,
    accounts: packEntry.compiledAccounts.map((account) => ({
      code: account.code,
      name: account.name,
      type: account.type,
      normalSide: account.normalSide,
      parentCode: account.parentCode,
      isPostable: account.isPostable,
      statementLineKey: account.statementLineKey as ChartAccountRow['statementLineKey'],
      active: true,
    })),
  });

  await appendAuditLog(tx, {
    companyId: params.companyId,
    actorId: params.actorId,
    action: 'pack.apply',
    targetTable: 'account',
    targetId: params.companyId,
    oldPayload: null,
    newPayload: {
      packKey: packEntry.detail.key,
      packVersion: packEntry.detail.version,
      sha256ManifestHash: packEntry.detail.sha256ManifestHash,
      inserted,
      updated,
      codes: packEntry.compiledAccounts.map((a) => a.code),
    },
    occurredAt: params.occurredAt,
  });

  return {
    companyId: params.companyId,
    packKey: packEntry.detail.key,
    packVersion: packEntry.detail.version,
    inserted,
    updated,
    accounts: await listChartAccounts(tx, params.companyId),
  };
}
