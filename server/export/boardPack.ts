import ExcelJS from 'exceljs';
import type { Content } from 'pdfmake/interfaces';
import pdfmake from 'pdfmake/build/pdfmake.js';
import helvetica from 'pdfmake/build/standard-fonts/Helvetica.js';
import PptxGenJS from 'pptxgenjs';
import { evaluateKpiLibrary, type CurrencyScale } from '../../core/metrics/index.js';
import { scaleForCurrency } from '../../core/money/index.js';
import { STATEMENT_LINE_MAP } from '../../core/statements/index.js';
import {
  BOARD_PACK_KEY_NAMESPACES,
  NOT_PLANNED,
  type BoardPackExportFormat,
  type BoardPackReport,
  type BoardPackRow,
  type BoardPackSection,
} from '../../shared/boardPack.js';
import { AppError } from '../../shared/errors.js';
import type { FinancialStatements } from '../../shared/reports.js';
import type { BvaReport } from '../../shared/bva.js';
import type { SqlExecutor } from '../db/migrate.js';
import { getBvaReport } from '../db/repositories/bva.js';
import { getFinancialStatements } from '../db/repositories/reports.js';
import { getApprovedCommentaries } from '../db/repositories/ai.js';

/**
 * Board-pack assembly and rendering (MASTER_PROMPT §9.3.7, A6/U5/G7).
 *
 * This module TRANSPORTS numbers produced by /core: `getFinancialStatements` and `getBvaReport`
 * already did every calculation through Decimal primitives. Rows are assembled from those typed
 * reports, and both renderers print the same strings verbatim — no money arithmetic, no rounding,
 * no formatting that could make one artifact disagree with another (§3.1 kernel law).
 */

interface CompanyRow extends Record<string, unknown> {
  name: string;
  base_currency: string;
}

export interface BoardPackParams {
  readonly companyId: string;
  readonly throughPeriodCode: string;
  readonly fiscalYear?: number | null;
}

function line(
  section: BoardPackSection,
  key: string,
  label: string,
  value: string,
  detail: string | null = null,
): BoardPackRow {
  return { section, key, label, value, detail };
}

function statementRows(
  section: 'pl' | 'bs',
  byKey: Readonly<Record<string, string>>,
): readonly BoardPackRow[] {
  return Object.keys(byKey)
    .sort()
    .map((key) => {
      const spec = STATEMENT_LINE_MAP.get(key);
      if (spec === undefined) {
        // The catalog is the only vocabulary; a report naming an unknown key is a server defect.
        throw new AppError('INTERNAL_ERROR', { details: { statementLineKey: key } });
      }
      return line(section, `${BOARD_PACK_KEY_NAMESPACES.statement}${key}`, spec.label, byKey[key] ?? '');
    });
}

export async function buildBoardPackReport(
  db: SqlExecutor,
  params: BoardPackParams,
): Promise<BoardPackReport> {
  const identity = await db.query<CompanyRow>(
    `SELECT name, base_currency FROM company WHERE id = $1`,
    [params.companyId],
  );
  const company = identity.rows[0];
  if (company === undefined) {
    throw new AppError('TENANT_FORBIDDEN');
  }

  const statements: FinancialStatements = await getFinancialStatements(db, {
    companyId: params.companyId,
    throughPeriodCode: params.throughPeriodCode,
    ...(params.fiscalYear === undefined || params.fiscalYear === null
      ? {}
      : { fiscalYear: params.fiscalYear }),
  });
  const bva: BvaReport = await getBvaReport(db, {
    companyId: params.companyId,
    throughPeriodCode: params.throughPeriodCode,
    ...(params.fiscalYear === undefined || params.fiscalYear === null
      ? {}
      : { fiscalYear: params.fiscalYear }),
  });

  const currencyScale = scaleForCurrency(company.base_currency) as CurrencyScale;
  const coverKpis = evaluateKpiLibrary({
    currencyScale,
    hasPlan: bva.hasPlan,
    pnl: statements.pnl,
    balanceSheet: statements.balanceSheet,
    cashFlow: statements.cashFlow,
  });

  const prefix = BOARD_PACK_KEY_NAMESPACES.statement;
  const basisRange = `Year to date ${statements.range.fromPeriodCode} to ${statements.range.throughPeriodCode}, FY${statements.range.fiscalYear}`;
  const revKpi = coverKpis.byKey['pnl.revenue']!;
  const niKpi = coverKpis.byKey['pnl.net_income']!;
  const assetsKpi = coverKpis.byKey['bs.total_assets']!;
  const cashKpi = coverKpis.byKey['cf.ending_cash']!;
  const rows: BoardPackRow[] = [
    line('cover', revKpi.boardPackKey ?? `${prefix}pnl.revenue`, revKpi.label, revKpi.value ?? NOT_PLANNED, basisRange),
    line('cover', niKpi.boardPackKey ?? `${prefix}pnl.netIncome`, niKpi.label, niKpi.value ?? NOT_PLANNED, basisRange),
    line('cover', assetsKpi.boardPackKey ?? `${prefix}bs.totalAssets`, assetsKpi.label, assetsKpi.value ?? NOT_PLANNED, basisRange),
    line('cover', cashKpi.boardPackKey ?? `${prefix}cf.endingCash`, cashKpi.label, cashKpi.value ?? NOT_PLANNED, basisRange),

    line('pl', `${prefix}pnl.revenue`, 'Revenue', statements.pnl.revenue),
    line('pl', `${prefix}pnl.cogs`, 'Cost of goods sold', statements.pnl.cogs),
    line('pl', `${prefix}pnl.grossProfit`, 'Gross profit', statements.pnl.grossProfit),
    line('pl', `${prefix}pnl.opex`, 'Operating expenses', statements.pnl.opex),
    line('pl', `${prefix}pnl.ebitda`, 'EBITDA', statements.pnl.ebitda),
    line('pl', `${prefix}pnl.depreciation`, 'Depreciation & amortization', statements.pnl.depreciation),
    line('pl', `${prefix}pnl.ebit`, 'EBIT', statements.pnl.ebit),
    line('pl', `${prefix}pnl.nonOperatingNet`, 'Non-operating, net', statements.pnl.nonOperatingNet),
    line('pl', `${prefix}pnl.ebt`, 'Pre-tax income', statements.pnl.ebt),
    line('pl', `${prefix}pnl.tax`, 'Income tax', statements.pnl.tax),
    line('pl', `${prefix}pnl.netIncome`, 'Net income', statements.pnl.netIncome),
    ...statementRows('pl', statements.pnl.byKey),

    line('bs', `${prefix}bs.totalAssets`, 'Total assets', statements.balanceSheet.totalAssets),
    line('bs', `${prefix}bs.totalLiabilities`, 'Total liabilities', statements.balanceSheet.totalLiabilities),
    line('bs', `${prefix}bs.totalEquity`, 'Total equity', statements.balanceSheet.totalEquity),
    line(
      'bs',
      `${prefix}bs.totalLiabilitiesAndEquity`,
      'Total liabilities and equity',
      statements.balanceSheet.totalLiabilitiesAndEquity,
    ),
    line('bs', `${prefix}bs.cashBalance`, 'Cash balance', statements.balanceSheet.cashBalance),
    ...statementRows('bs', statements.balanceSheet.byKey),

    line('cf', `${prefix}cf.netIncome`, 'Net income', statements.cashFlow.netIncome),
    line('cf', `${prefix}cf.nonCashAddbacks`, 'Non-cash addbacks', statements.cashFlow.nonCashAddbacks),
    line(
      'cf',
      `${prefix}cf.deltaWorkingCapitalCashImpact`,
      'Working-capital impact',
      statements.cashFlow.deltaWorkingCapitalCashImpact,
    ),
    line('cf', `${prefix}cf.operatingCashFlow`, 'Operating cash flow', statements.cashFlow.operatingCashFlow),
    line('cf', `${prefix}cf.investingCashFlow`, 'Investing cash flow', statements.cashFlow.investingCashFlow),
    line('cf', `${prefix}cf.freeCashFlow`, 'Free cash flow', statements.cashFlow.freeCashFlow),
    line('cf', `${prefix}cf.financingCashFlow`, 'Financing cash flow', statements.cashFlow.financingCashFlow),
    line('cf', `${prefix}cf.beginningCash`, 'Beginning cash', statements.cashFlow.beginningCash),
    line('cf', `${prefix}cf.endingCash`, 'Ending cash', statements.cashFlow.endingCash),
  ];

  for (const bvaRow of bva.rows) {
    const plan = bvaRow.plan ?? NOT_PLANNED;
    const variance = bvaRow.varianceAmount ?? NOT_PLANNED;
    const pct = bvaRow.variancePctFormatted ?? NOT_PLANNED;
    rows.push(
      line(
        'bva',
        `${BOARD_PACK_KEY_NAMESPACES.variance}${bvaRow.accountCode}`,
        `${bvaRow.accountCode} - ${bvaRow.accountName}`,
        bvaRow.actual ?? NOT_PLANNED,
        `Plan ${plan}; variance ${variance}; ${pct}; ${bvaRow.favorability}`,
      ),
    );
  }

  // NAR2: Board pack includes ONLY approved or locked commentary, never ai_draft
  try {
    const periodRes = await db.query<{ id: string }>(
      `SELECT id FROM fiscal_period WHERE company_id = $1 AND code = $2`,
      [params.companyId, statements.range.throughPeriodCode]
    );
    const periodRow = periodRes.rows[0];
    if (periodRow) {
      const periodId = periodRow.id;
      const approvedComms = await getApprovedCommentaries(db, params.companyId, periodId);
      const commMap = new Map<string, string>();
      for (const c of approvedComms) {
        commMap.set(c.statement_line_key, c.disclosure);
      }
      for (const row of rows) {
        const lineKey = row.key.replace(BOARD_PACK_KEY_NAMESPACES.statement, '');
        const disclosure = commMap.get(lineKey);
        if (disclosure && !row.detail) {
          (row as { detail: string }).detail = disclosure;
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && !err.message.includes('relation "narrative_commentary" does not exist')) {
      throw err;
    }
  }

  const planBasis =
    bva.scenarioName === null
      ? 'no current plan version'
      : `${bva.scenarioName}${bva.versionNo === null ? '' : ` v${bva.versionNo}`}`;

  return {
    companyId: params.companyId,
    companyName: company.name,
    baseCurrency: company.base_currency,
    range: statements.range,
    rows,
    articulation: statements.articulation,
    sources: statements.sources,
    hasPlan: bva.hasPlan,
    basis: `${basisRange}; plan basis: ${planBasis}`,
    disclosure:
      'Every figure is year-to-date engine output from committed GL postings. Plan figures come from the current plan version; "not planned" means no plan line exists for that account.',
    bva,
  };
}

const SECTION_TITLES: Readonly<Record<BoardPackSection, string>> = {
  cover: 'Cover KPIs',
  pl: 'Income Statement (P&L)',
  bs: 'Balance Sheet',
  cf: 'Cash Flow (indirect)',
  bva: 'Budget vs Actual',
};

const SECTION_ORDER: readonly BoardPackSection[] = ['cover', 'pl', 'bs', 'cf', 'bva'];

async function renderXlsx(pack: BoardPackReport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OneFP&A';
  workbook.title = `Board Pack - ${pack.companyName}`;
  workbook.subject = pack.basis;

  for (const section of SECTION_ORDER) {
    const sheet = workbook.addWorksheet(SECTION_TITLES[section]);
    sheet.addRow(['Section', 'Key', 'Label', 'Value', 'Detail']);
    for (const row of pack.rows.filter((candidate) => candidate.section === section)) {
      sheet.addRow([row.section, row.key, row.label, row.value, row.detail ?? '']);
    }
  }

  const provenance = workbook.addWorksheet('Provenance');
  provenance.addRow(['Field', 'Value']);
  provenance.addRow(['Company', pack.companyName]);
  provenance.addRow(['Currency', pack.baseCurrency]);
  provenance.addRow(['Basis', pack.basis]);
  provenance.addRow(['Disclosure', pack.disclosure]);
  for (const source of pack.sources) {
    provenance.addRow(['Committed source', `${source.sourceFilename} (${source.sourceHash})`]);
  }
  for (const check of pack.articulation.checks) {
    provenance.addRow([`Articulation ${check.id}`, `${check.passed ? 'pass' : 'fail'} ${check.delta}`]);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

pdfmake.addFontContainer(helvetica);
// The pack renders only local, engine-issued strings; no external resource may be fetched (SEC4).
pdfmake.setUrlAccessPolicy(() => false);

async function renderPdf(pack: BoardPackReport): Promise<Buffer> {
  const content: Content[] = [
    { text: 'Board Pack', style: 'title' },
    { text: pack.companyName, style: 'subtitle' },
    { text: `${pack.baseCurrency} - ${pack.basis}` },
    { text: pack.disclosure, style: 'small' },
  ];
  for (const section of SECTION_ORDER) {
    content.push({ text: SECTION_TITLES[section], style: 'section', pageBreak: 'before' });
    content.push({
      table: {
        headerRows: 1,
        widths: [190, 95, 190],
        body: [
          ['Label', 'Value', 'Detail'],
          ...pack.rows
            .filter((row) => row.section === section)
            .map((row) => [row.label, row.value, row.detail ?? '']),
        ],
      },
      style: 'small',
    });
  }
  content.push({ text: 'Provenance', style: 'section', pageBreak: 'before' });
  for (const source of pack.sources) {
    content.push({ text: `${source.sourceFilename} - ${source.sourceHash}`, style: 'small' });
  }
  for (const check of pack.articulation.checks) {
    content.push({ text: `${check.id} ${check.passed ? 'pass' : 'fail'} ${check.delta}`, style: 'small' });
  }

  return pdfmake.createPdf({
    // Uncompressed content keeps the byte-level cross-artifact test independent of any PDF parser.
    compress: false,
    defaultStyle: { font: 'Helvetica', fontSize: 8 },
    styles: {
      title: { fontSize: 18, bold: true },
      subtitle: { fontSize: 12, bold: true },
      section: { fontSize: 12, bold: true },
      small: { fontSize: 8 },
    },
    content,
  }).getBuffer();
}

const PPTX_ROWS_PER_SLIDE = 13;

function chunkRows<T>(items: readonly T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
}

async function renderPptx(pack: BoardPackReport): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'OneFP&A';
  pptx.company = pack.companyName;
  pptx.title = `Board Pack - ${pack.companyName}`;
  pptx.subject = pack.basis;

  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: 'F8FAFC' };
  titleSlide.addShape('rect', { x: 0, y: 0, w: 10, h: 1.35, fill: { color: '0F172A' }, line: { color: '0F172A' } });
  titleSlide.addText('Board Pack', {
    x: 0.6,
    y: 0.3,
    w: 8.8,
    h: 0.75,
    fontFace: 'Helvetica',
    fontSize: 28,
    bold: true,
    color: 'FFFFFF',
  });
  titleSlide.addText(pack.companyName, {
    x: 0.6,
    y: 1.6,
    w: 8.8,
    h: 0.5,
    fontFace: 'Helvetica',
    fontSize: 20,
    bold: true,
    color: '0F172A',
  });
  titleSlide.addText(`${pack.baseCurrency} - ${pack.basis}`, {
    x: 0.6,
    y: 2.2,
    w: 8.8,
    h: 0.45,
    fontFace: 'Helvetica',
    fontSize: 12,
    color: '334155',
  });
  titleSlide.addText(
    `Articulation: ${pack.articulation.valid ? 'all checks passed' : 'check failures present'}`,
    {
      x: 0.6,
      y: 2.75,
      w: 8.8,
      h: 0.35,
      fontFace: 'Helvetica',
      fontSize: 11,
      bold: true,
      color: pack.articulation.valid ? '047857' : 'B91C1C',
    },
  );
  titleSlide.addText(pack.disclosure, {
    x: 0.6,
    y: 3.3,
    w: 8.8,
    h: 1.4,
    fontFace: 'Helvetica',
    fontSize: 10,
    color: '475569',
    valign: 'top',
  });

  for (const section of SECTION_ORDER) {
    const sectionRows = pack.rows.filter((candidate) => candidate.section === section);
    const pages = chunkRows(sectionRows, PPTX_ROWS_PER_SLIDE);

    pages.forEach((pageRows, pageIndex) => {
      const slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };
      const titleSuffix = pages.length > 1 ? ` (${pageIndex + 1}/${pages.length})` : '';
      slide.addText(`${SECTION_TITLES[section]}${titleSuffix}`, {
        x: 0.5,
        y: 0.3,
        w: 9.0,
        h: 0.4,
        fontFace: 'Helvetica',
        fontSize: 16,
        bold: true,
        color: '0F172A',
      });
      slide.addText(`${pack.companyName} · ${pack.baseCurrency} · ${pack.basis}`, {
        x: 0.5,
        y: 0.68,
        w: 9.0,
        h: 0.25,
        fontFace: 'Helvetica',
        fontSize: 8,
        color: '64748B',
      });

      const headerRow: PptxGenJS.TableRow = [
        { text: 'Label', options: { bold: true, color: 'FFFFFF', fill: { color: '0F172A' } } },
        { text: 'Value', options: { bold: true, color: 'FFFFFF', fill: { color: '0F172A' }, align: 'right' } },
        { text: 'Detail', options: { bold: true, color: 'FFFFFF', fill: { color: '0F172A' } } },
      ];
      const bodyRows: PptxGenJS.TableRow[] =
        pageRows.length === 0
          ? [[{ text: 'No rows in section' }, { text: '' }, { text: '' }]]
          : pageRows.map((row, idx) => {
              const rowFill = idx % 2 === 1 ? { color: 'F8FAFC' } : { color: 'FFFFFF' };
              return [
                { text: row.label, options: { fill: rowFill, color: '0F172A' } },
                {
                  text: row.value,
                  options: {
                    fill: rowFill,
                    color: '0F172A',
                    align: 'right',
                    fontFace: 'Courier New',
                  },
                },
                { text: row.detail ?? '', options: { fill: rowFill, color: '475569' } },
              ];
            });

      slide.addTable([headerRow, ...bodyRows], {
        x: 0.5,
        y: 1.0,
        w: 9.0,
        colW: [3.2, 1.6, 4.2],
        fontFace: 'Helvetica',
        fontSize: 8.5,
        border: { type: 'solid', pt: 0.5, color: 'CBD5E1' },
        margin: [0.04, 0.06, 0.04, 0.06],
      });
    });
  }

  const provenanceRows: PptxGenJS.TableRow[] = [
    [{ text: 'Company' }, { text: pack.companyName }],
    [{ text: 'Currency' }, { text: pack.baseCurrency }],
    [{ text: 'Basis' }, { text: pack.basis }],
    [{ text: 'Disclosure' }, { text: pack.disclosure }],
    ...pack.sources.map((source): PptxGenJS.TableRow => [
      { text: 'Committed source' },
      { text: `${source.sourceFilename} - ${source.sourceHash}` },
    ]),
    ...pack.articulation.checks.map((check): PptxGenJS.TableRow => [
      { text: `Articulation ${check.id}` },
      { text: `${check.id} ${check.passed ? 'pass' : 'fail'} ${check.delta}` },
    ]),
  ];

  const provenancePages = chunkRows(provenanceRows, PPTX_ROWS_PER_SLIDE);
  provenancePages.forEach((pageRows, pageIndex) => {
    const provSlide = pptx.addSlide();
    provSlide.background = { color: 'FFFFFF' };
    const titleSuffix = provenancePages.length > 1 ? ` (${pageIndex + 1}/${provenancePages.length})` : '';
    provSlide.addText(`Provenance${titleSuffix}`, {
      x: 0.5,
      y: 0.3,
      w: 9.0,
      h: 0.4,
      fontFace: 'Helvetica',
      fontSize: 16,
      bold: true,
      color: '0F172A',
    });
    const provHeader: PptxGenJS.TableRow = [
      { text: 'Field', options: { bold: true, color: 'FFFFFF', fill: { color: '0F172A' } } },
      { text: 'Value', options: { bold: true, color: 'FFFFFF', fill: { color: '0F172A' } } },
    ];
    provSlide.addTable([provHeader, ...pageRows], {
      x: 0.5,
      y: 0.9,
      w: 9.0,
      colW: [2.2, 6.8],
      fontFace: 'Helvetica',
      fontSize: 8.5,
      border: { type: 'solid', pt: 0.5, color: 'CBD5E1' },
      margin: [0.04, 0.06, 0.04, 0.06],
    });
  });

  const raw = await pptx.write({ outputType: 'nodebuffer' });
  if (raw instanceof Uint8Array) {
    return Buffer.from(raw);
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw);
  }
  if (typeof raw === 'string') {
    return Buffer.from(raw, 'binary');
  }
  return Buffer.from(await raw.arrayBuffer());
}

export function renderBoardPack(
  pack: BoardPackReport,
  format: BoardPackExportFormat,
): Promise<Buffer> {
  if (format === 'xlsx') return renderXlsx(pack);
  if (format === 'pdf') return renderPdf(pack);
  return renderPptx(pack);
}
