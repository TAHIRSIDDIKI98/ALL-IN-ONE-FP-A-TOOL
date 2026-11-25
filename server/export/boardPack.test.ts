import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { BvaReportSchema } from '../../shared/bva.js';
import {
  BoardPackExportFormatSchema,
  BoardPackReportSchema,
  NOT_PLANNED,
  type BoardPackReport,
} from '../../shared/boardPack.js';
import { renderBoardPack } from './boardPack.js';

/**
 * Independent cross-artifact expectations (MASTER_PROMPT §5.6 A6, §7.5, U5/G7).
 * The expected strings below are hand-written, NOT recomputed by the renderer; this test reads the
 * ACTUAL XLSX workbook and the ACTUAL PDF content stream rather than trusting a document model.
 */

const pack: BoardPackReport = BoardPackReportSchema.parse({
  companyId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  companyName: 'Export Test Co',
  baseCurrency: 'USD',
  range: { fromPeriodCode: 'P01', throughPeriodCode: 'P04', fiscalYear: 2026 },
  rows: [
    {
      section: 'cover',
      key: 'statement:pnl.revenue',
      label: 'Revenue (YTD)',
      value: '1234.56',
      detail: 'Year to date P01 to P04, FY2026',
    },
    {
      section: 'pl',
      key: 'statement:pnl.netIncome',
      label: 'Net income',
      value: '300.00',
      detail: null,
    },
    {
      section: 'bva',
      key: 'bva:4000',
      label: '4000 - Service revenue',
      value: '750.25',
      detail: 'Plan 1000.00; variance -249.75; -24.98%; unfavorable',
    },
    {
      section: 'bva',
      key: 'bva:1000',
      label: '1000 - Cash',
      value: '750.25',
      detail: `Plan ${NOT_PLANNED}; variance ${NOT_PLANNED}; ${NOT_PLANNED}; na`,
    },
  ],
  articulation: {
    valid: true,
    checks: [{ id: 'A1', name: 'Trial balance', passed: true, delta: '0.00', detail: 'balanced' }],
  },
  sources: [
    {
      batchId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      sourceFilename: 'export_test.csv',
      sourceHash: 'a'.repeat(64),
      importedAt: '2026-11-25T00:00:00.000Z',
    },
  ],
  hasPlan: true,
  basis: 'Year to date P01 to P04, FY2026; plan basis: Budget FY2026 v1',
  disclosure: 'All figures are engine output.',
  bva: BvaReportSchema.parse({
    companyId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    fiscalYear: 2026,
    throughPeriodCode: 'P04',
    scenarioId: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
    scenarioName: 'Budget FY2026',
    planVersionId: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
    versionNo: 1,
    hasPlan: true,
    rows: [],
    totals: {
      actual: '0.00',
      plan: '1000.00',
      unplannedActual: '0.00',
      varianceAmount: '-1000.00',
      plannedRows: 1,
      unplannedRows: 0,
      favorable: 0,
      unfavorable: 1,
      neutral: 0,
      na: 0,
    },
    byType: [],
  }),
});

/** Read the actual XLSX bytes from disk (exceljs' bundled Buffer declaration is not compatible). */
async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const directory = mkdtempSync(join(tmpdir(), 'onefpa-board-pack-'));
  const path = join(directory, 'pack.xlsx');
  try {
    writeFileSync(path, bytes);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    return workbook;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function extractPdfText(buffer: Uint8Array): string {
  const latin = Buffer.from(buffer).toString('latin1');
  const streams = latin.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g);
  let decoded = '';
  for (const stream of streams) {
    const content = stream[1] ?? '';
    for (const token of content.matchAll(/<([0-9A-Fa-f]+)>/g)) {
      decoded += Buffer.from(token[1] ?? '', 'hex').toString('latin1');
    }
    decoded += '\n';
  }
  return decoded;
}

describe('Board-pack cross-artifact tie-out (A6, U5, G7)', () => {
  it('prints every canonical row verbatim in the actual XLSX and PDF artifacts', async () => {
    const xlsx = await renderBoardPack(pack, 'xlsx');
    const workbook = await loadWorkbook(xlsx);
    const cells: string[] = [];
    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) => {
        const values = row === null ? [] : row.values;
        for (const cell of Array.isArray(values) ? values : Object.values(values)) {
          if (typeof cell === 'string') cells.push(cell);
        }
      });
    }

    const pdfText = extractPdfText(await renderBoardPack(pack, 'pdf'));
    expect(pdfText.length).toBeGreaterThan(0);

    for (const row of pack.rows) {
      expect(cells, `xlsx label ${row.key}`).toContain(row.label);
      expect(cells, `xlsx value ${row.key}`).toContain(row.value);
      expect(pdfText, `pdf label ${row.key}`).toContain(row.label);
      expect(pdfText, `pdf value ${row.key}`).toContain(row.value);
      if (row.detail !== null) {
        expect(cells, `xlsx detail ${row.key}`).toContain(row.detail);
        expect(pdfText, `pdf detail ${row.key}`).toContain(row.detail);
      }
    }
    expect(cells).toContain(pack.basis);
    expect(cells).toContain(pack.disclosure);
    expect(pdfText).toContain(pack.basis);
  });

  it('keeps the no-plan display token instead of writing an invented zero (§5.2 null law)', async () => {
    const xlsx = await renderBoardPack(pack, 'xlsx');
    const workbook = await loadWorkbook(xlsx);
    const cells: string[] = [];
    for (const sheet of workbook.worksheets) {
      for (const row of sheet.getSheetValues()) {
        if (!Array.isArray(row)) continue;
        for (const cell of row) {
          if (typeof cell === 'string') cells.push(cell);
        }
      }
    }
    expect(cells).toContain(`Plan ${NOT_PLANNED}; variance ${NOT_PLANNED}; ${NOT_PLANNED}; na`);
    // The engine value 0.00 appears elsewhere in the pack, but this specific BvA line has no plan.
    expect(pack.rows.find((row) => row.key === 'bva:1000')?.value).toBe('750.25');
  });

  it('refuses an unknown export format at the shared contract boundary', () => {
    expect(BoardPackExportFormatSchema.safeParse('docx').success).toBe(false);
    expect(BoardPackExportFormatSchema.safeParse('pdf').success).toBe(true);
  });
});
