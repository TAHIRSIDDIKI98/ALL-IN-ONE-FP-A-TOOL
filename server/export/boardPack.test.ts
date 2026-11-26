import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
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

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function extractPptxSlides(bytes: Uint8Array): {
  readonly slideCount: number;
  readonly runs: readonly string[];
  readonly joined: string;
} {
  const buf = Buffer.from(bytes);
  expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');

  let eocdPos = -1;
  for (let pos = buf.length - 22; pos >= 0 && pos >= buf.length - 65_557; pos -= 1) {
    if (buf.readUInt32LE(pos) === 0x06054b50) {
      eocdPos = pos;
      break;
    }
  }
  expect(eocdPos).toBeGreaterThanOrEqual(0);

  const cdEntries = buf.readUInt16LE(eocdPos + 10);
  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  const runs: string[] = [];
  let slideCount = 0;

  let cursor = cdOffset;
  for (let idx = 0; idx < cdEntries; idx += 1) {
    expect(buf.readUInt32LE(cursor)).toBe(0x02014b50);
    const method = buf.readUInt16LE(cursor + 10);
    const compSize = buf.readUInt32LE(cursor + 20);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const entryName = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    cursor = cursor + 46 + nameLen + extraLen + commentLen;

    if (!/^ppt\/slides\/slide\d+\.xml$/.test(entryName)) continue;
    slideCount += 1;
    expect(buf.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataPos = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataPos, dataPos + compSize);
    const xml = (method === 8 ? inflateRawSync(compressed) : compressed).toString('utf8');
    for (const match of xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)) {
      runs.push(decodeXmlEntities(match[1] ?? ''));
    }
  }

  return { slideCount, runs, joined: runs.join('\n') };
}

describe('Board-pack cross-artifact tie-out (A6, U5, G7)', () => {
  it('prints every canonical row verbatim in the actual XLSX, PDF, and PPTX artifacts', async () => {
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

    const pptx = await renderBoardPack(pack, 'pptx');
    const pptxSlides = extractPptxSlides(pptx);
    expect(pptxSlides.slideCount).toBe(7);

    for (const row of pack.rows) {
      expect(cells, `xlsx label ${row.key}`).toContain(row.label);
      expect(cells, `xlsx value ${row.key}`).toContain(row.value);
      expect(pdfText, `pdf label ${row.key}`).toContain(row.label);
      expect(pdfText, `pdf value ${row.key}`).toContain(row.value);
      expect(pptxSlides.runs, `pptx label ${row.key}`).toContain(row.label);
      expect(pptxSlides.runs, `pptx value ${row.key}`).toContain(row.value);
      if (row.detail !== null) {
        expect(cells, `xlsx detail ${row.key}`).toContain(row.detail);
        expect(pdfText, `pdf detail ${row.key}`).toContain(row.detail);
        expect(pptxSlides.runs, `pptx detail ${row.key}`).toContain(row.detail);
      }
    }
    expect(cells).toContain(pack.basis);
    expect(cells).toContain(pack.disclosure);
    expect(pdfText).toContain(pack.basis);
    expect(pptxSlides.runs).toContain(pack.basis);
    expect(pptxSlides.runs).toContain(pack.disclosure);
    expect(pptxSlides.runs).toContain(pack.companyName);
    expect(pptxSlides.runs).toContain(pack.baseCurrency);
    expect(pptxSlides.runs).toContain(`${pack.sources[0]?.sourceFilename} - ${pack.sources[0]?.sourceHash}`);
    expect(pptxSlides.runs).toContain('A1 pass 0.00');
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
    const pptxSlides = extractPptxSlides(await renderBoardPack(pack, 'pptx'));
    expect(cells).toContain(`Plan ${NOT_PLANNED}; variance ${NOT_PLANNED}; ${NOT_PLANNED}; na`);
    expect(pptxSlides.runs).toContain(`Plan ${NOT_PLANNED}; variance ${NOT_PLANNED}; ${NOT_PLANNED}; na`);
    // The engine value 0.00 appears elsewhere in the pack, but this specific BvA line has no plan.
    expect(pack.rows.find((row) => row.key === 'bva:1000')?.value).toBe('750.25');
  });

  it('paginates long board-pack sections cleanly across multiple PPTX slides without dropping rows', async () => {
    const manyBvaRows = Array.from({ length: 28 }, (_, index) => {
      const code = String(4000 + index);
      return {
        section: 'bva' as const,
        key: `bva:${code}`,
        label: `${code} - Line ${code}`,
        value: `${index + 100}.00`,
        detail: `Plan ${index + 90}.00; variance 10.00; 11.11%; favorable`,
      };
    });
    const largePack = BoardPackReportSchema.parse({ ...pack, rows: [...pack.rows.slice(0, 2), ...manyBvaRows] });
    const pptxSlides = extractPptxSlides(await renderBoardPack(largePack, 'pptx'));
    // 1 title + 1 cover + 1 pl + 1 bs + 1 cf + 3 bva (28 rows / 13 per slide) + 1 provenance = 9 slides
    expect(pptxSlides.slideCount).toBe(9);
    for (const row of manyBvaRows) {
      expect(pptxSlides.runs).toContain(row.label);
      expect(pptxSlides.runs).toContain(row.value);
      expect(pptxSlides.runs).toContain(row.detail);
    }
  });

  it('refuses an unknown export format at the shared contract boundary', () => {
    expect(BoardPackExportFormatSchema.safeParse('docx').success).toBe(false);
    expect(BoardPackExportFormatSchema.safeParse('xlsx').success).toBe(true);
    expect(BoardPackExportFormatSchema.safeParse('pdf').success).toBe(true);
    expect(BoardPackExportFormatSchema.safeParse('pptx').success).toBe(true);
  });

  it('links Board Pack cover KPIs to canonical /core/metrics definitions via boardPackKey (RPT1)', async () => {
    const { METRIC_CATALOG_BY_KEY } = await import('../../core/metrics/index.js');
    const coverMetric = METRIC_CATALOG_BY_KEY.get('pnl.revenue');
    expect(coverMetric?.boardPackKey).toBe('statement:pnl.revenue');
    expect(METRIC_CATALOG_BY_KEY.get('pnl.net_income')?.boardPackKey).toBe('statement:pnl.netIncome');
    expect(METRIC_CATALOG_BY_KEY.get('bs.total_assets')?.boardPackKey).toBe('statement:bs.totalAssets');
    expect(METRIC_CATALOG_BY_KEY.get('cf.ending_cash')?.boardPackKey).toBe('statement:cf.endingCash');
  });
});
