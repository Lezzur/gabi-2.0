import ExcelJS from 'exceljs';

import type { FormulationType, ProductType, ToxicityCategory } from '@gaia/shared/types';

// ---- Public types ----

export type FpaRow = {
  row_index: number;
  fpa_registration_number: string;
  product_name: string;
  company: string;
  active_ingredient: string;
  concentration: string | null;
  formulation_type: FormulationType | null;
  type: ProductType | null;
  category: ToxicityCategory | null;
  fpa_registration_expires_at: string | null;
  mode_of_entry: string | null;
  registered_crops: string;
  pests: string | null;
  dosage_rate: string | null;
  mrl: string | null;
  pre_harvest_interval: string | null;
  re_entry_period: string | null;
};

export type ParseErrorCode =
  | 'SHEET_NOT_FOUND'
  | 'MISSING_HEADER'
  | 'ROW_LIMIT_EXCEEDED'
  | 'EMPTY_REGISTRATION'
  | 'UNPARSEABLE_DATE'
  | 'INVALID_TOXICITY'
  | 'INVALID_FORMULATION_TYPE'
  | 'WORKBOOK_PARSE_ERROR';

export type ParseError = {
  row_index: number | null;
  column: string | null;
  code: ParseErrorCode;
  message: string;
};

// ---- Constants ----

const SHEET_NAME = 'LIST';
const HEADER_ROW_NUMBER = 6;   // 1-indexed (row index 5, 0-based)
const DATA_START_ROW = 7;      // 1-indexed (row index 6, 0-based)
const MAX_DATA_ROWS = 50_000;

const EXPECTED_HEADERS = [
  'NAME OF COMPANY',
  'ACTIVE INGREDIENT',
  'PRODUCT NAME',
  'CONCENTRATION',
  'FORMULATION TYPE',
  'USE/S',
  'TOXICITY CATEGORY',
  'REGISTRATION NO.',
  'EXPIRY DATE',
  'MODE OF ENTRY',
  'CROPS',
  'PESTS / WEEDS / DISEASES',
  'RECOMMENDED RATE',
  'MRL (PROPOSED)',
  'PHI',
  'RE-ENTRY PERIOD',
] as const;

type ExpectedHeader = (typeof EXPECTED_HEADERS)[number];

const PRODUCT_TYPE_MAP: Record<string, ProductType> = {
  HERBICIDE: 'HERBICIDE',
  INSECTICIDE: 'INSECTICIDE',
  FUNGICIDE: 'FUNGICIDE',
  RODENTICIDE: 'RODENTICIDE',
  MOLLUSCICIDE: 'MOLLUSCICIDE',
  NEMATICIDE: 'NEMATICIDE',
  ACARICIDE: 'ACARICIDE',
};

const VALID_FORMULATION_TYPES = new Set<string>([
  'EC', 'SC', 'WP', 'WG', 'SL', 'GR', 'DP', 'ULV', 'OTHER',
]);

const VALID_TOXICITY_CATEGORIES = new Set<string>(['1', '2', '3', '4']);

// Roman numeral → digit for toxicity category (I=1, II=2, III=3, IV=4)
const ROMAN_TO_DIGIT: Record<string, string> = { I: '1', II: '2', III: '3', IV: '4' };

const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

// ---- String helpers ----

function sanitize(s: string): string {
  return s.replace(CONTROL_CHARS_RE, '').trim();
}

function cellText(cell: ExcelJS.Cell): string {
  return sanitize(cell.text);
}

function normalizeHeaderKey(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, ' ').trim();
}

// ---- Date parsing ----

function excelSerialToIso(serial: number): string {
  return new Date((serial - 25569) * 86400 * 1000).toISOString().slice(0, 10);
}

// Returns ISO date string, null (empty/missing), or 'ERROR' (unparseable)
function parseExpiryDate(value: unknown): string | null | 'ERROR' {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? 'ERROR' : value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number') {
    if (!isFinite(value) || value < 1 || value > 2_958_465) return 'ERROR';
    return excelSerialToIso(value);
  }

  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? 'ERROR' : d.toISOString().slice(0, 10);
  }

  // Formula cell — recurse into result
  if (typeof value === 'object' && 'result' in value) {
    return parseExpiryDate((value as { result: unknown }).result);
  }

  return 'ERROR';
}

// ---- Field normalizers ----

function normalizeProductType(raw: string): ProductType {
  return PRODUCT_TYPE_MAP[raw.toUpperCase().trim()] ?? 'OTHER';
}

function normalizeToxicityCategory(raw: string): ToxicityCategory | null | 'INVALID' {
  const s = raw.trim();
  if (!s) return null;

  // Handle Roman numerals (I, II, III, IV)
  const digit = ROMAN_TO_DIGIT[s.toUpperCase()] ?? s;
  if (VALID_TOXICITY_CATEGORIES.has(digit)) return digit as ToxicityCategory;

  // Handle "CLASS 2", "CATEGORY 3" style labels
  const m = /(\d)/.exec(s);
  const extracted = m?.[1];
  if (extracted !== undefined && VALID_TOXICITY_CATEGORIES.has(extracted)) {
    return extracted as ToxicityCategory;
  }

  return 'INVALID';
}

function normalizeFormulationType(raw: string): FormulationType | null | 'INVALID' {
  const upper = raw.toUpperCase().trim();
  if (!upper) return null;
  return VALID_FORMULATION_TYPES.has(upper) ? (upper as FormulationType) : 'INVALID';
}

// ---- Main export ----

export async function parseFpaSpreadsheet(
  buffer: Buffer,
): Promise<{ rows: FpaRow[]; errors: ParseError[] }> {
  const errors: ParseError[] = [];
  const rows: FpaRow[] = [];

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    // ExcelJS types say non-nullable but returns undefined at runtime if not found
    const sheet = workbook.getWorksheet(SHEET_NAME) as ExcelJS.Worksheet | undefined;
    if (sheet === undefined) {
      errors.push({
        row_index: null,
        column: null,
        code: 'SHEET_NOT_FOUND',
        message: `Sheet '${SHEET_NAME}' not found in workbook`,
      });
      return { rows, errors };
    }

    // Build header → column-number map (case/whitespace-insensitive)
    const colByHeader = new Map<string, number>();
    sheet.getRow(HEADER_ROW_NUMBER).eachCell({ includeEmpty: false }, (cell, colNum) => {
      const key = normalizeHeaderKey(cell.text);
      if (key) colByHeader.set(key, colNum);
    });

    const missingHeaders: string[] = [];
    for (const expected of EXPECTED_HEADERS) {
      if (!colByHeader.has(expected)) missingHeaders.push(expected);
    }
    if (missingHeaders.length > 0) {
      errors.push({
        row_index: null,
        column: missingHeaders.join(', '),
        code: 'MISSING_HEADER',
        message: `Missing required columns: ${missingHeaders.join(', ')}`,
      });
      return { rows, errors };
    }

    // Safe column lookup — headers already validated above
    const col = (h: ExpectedHeader): number => colByHeader.get(h) as number;

    // Enforce row limit before processing
    const lastRowNumber = sheet.lastRow?.number ?? DATA_START_ROW - 1;
    const dataRowCount = Math.max(0, lastRowNumber - DATA_START_ROW + 1);
    if (dataRowCount > MAX_DATA_ROWS) {
      errors.push({
        row_index: null,
        column: null,
        code: 'ROW_LIMIT_EXCEEDED',
        message: `File has ${dataRowCount} data rows, exceeding the ${MAX_DATA_ROWS}-row limit`,
      });
      return { rows, errors };
    }

    // Process data rows
    for (let rowNum = DATA_START_ROW; rowNum <= lastRowNumber; rowNum++) {
      const rowIdx = rowNum - DATA_START_ROW; // 0-based data row index
      const row = sheet.getRow(rowNum);

      // Skip rows with no registration number (req 72)
      const regNo = cellText(row.getCell(col('REGISTRATION NO.')));
      if (!regNo) {
        errors.push({
          row_index: rowIdx,
          column: 'REGISTRATION NO.',
          code: 'EMPTY_REGISTRATION',
          message: 'Empty REGISTRATION NO. — row skipped',
        });
        continue;
      }

      // Parse expiry date; skip row if unparseable (req 73)
      const expiryResult = parseExpiryDate(row.getCell(col('EXPIRY DATE')).value);
      if (expiryResult === 'ERROR') {
        errors.push({
          row_index: rowIdx,
          column: 'EXPIRY DATE',
          code: 'UNPARSEABLE_DATE',
          message: `Unparseable EXPIRY DATE: '${cellText(row.getCell(col('EXPIRY DATE')))}'`,
        });
        continue;
      }

      // Normalize toxicity category; invalid → null, log error, keep row (req 75)
      const categoryRaw = cellText(row.getCell(col('TOXICITY CATEGORY')));
      let category: ToxicityCategory | null = null;
      if (categoryRaw) {
        const catResult = normalizeToxicityCategory(categoryRaw);
        if (catResult === 'INVALID') {
          errors.push({
            row_index: rowIdx,
            column: 'TOXICITY CATEGORY',
            code: 'INVALID_TOXICITY',
            message: `Invalid TOXICITY CATEGORY: '${categoryRaw}' — field set to null`,
          });
        } else {
          category = catResult;
        }
      }

      // Normalize formulation type; unknown → null, log error, keep row (req 74)
      const formulationRaw = cellText(row.getCell(col('FORMULATION TYPE')));
      let formulation_type: FormulationType | null = null;
      if (formulationRaw) {
        const ftResult = normalizeFormulationType(formulationRaw);
        if (ftResult === 'INVALID') {
          errors.push({
            row_index: rowIdx,
            column: 'FORMULATION TYPE',
            code: 'INVALID_FORMULATION_TYPE',
            message: `Unknown FORMULATION TYPE: '${formulationRaw}' — field set to null`,
          });
        } else {
          formulation_type = ftResult;
        }
      }

      const typeRaw = cellText(row.getCell(col('USE/S')));

      rows.push({
        row_index: rowIdx,
        fpa_registration_number: regNo,
        product_name: cellText(row.getCell(col('PRODUCT NAME'))),
        company: cellText(row.getCell(col('NAME OF COMPANY'))),
        active_ingredient: cellText(row.getCell(col('ACTIVE INGREDIENT'))),
        concentration: cellText(row.getCell(col('CONCENTRATION'))) || null,
        formulation_type,
        type: typeRaw ? normalizeProductType(typeRaw) : null,
        category,
        fpa_registration_expires_at: expiryResult,
        mode_of_entry: cellText(row.getCell(col('MODE OF ENTRY'))) || null,
        registered_crops: cellText(row.getCell(col('CROPS'))),
        pests: cellText(row.getCell(col('PESTS / WEEDS / DISEASES'))) || null,
        dosage_rate: cellText(row.getCell(col('RECOMMENDED RATE'))) || null,
        mrl: cellText(row.getCell(col('MRL (PROPOSED)'))) || null,
        pre_harvest_interval: cellText(row.getCell(col('PHI'))) || null,
        re_entry_period: cellText(row.getCell(col('RE-ENTRY PERIOD'))) || null,
      });
    }
  } catch (err) {
    errors.push({
      row_index: null,
      column: null,
      code: 'WORKBOOK_PARSE_ERROR',
      message: `Failed to parse workbook: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return { rows, errors };
}
