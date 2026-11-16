// Reading contact lists from CSV files, and writing CSV.

/** Parses CSV text (comma, semicolon or tab separated, with quoted fields) into rows. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '');
  const firstLine = input.slice(0, input.search(/\r?\n|$/));
  const delimiter = [',', ';', '\t'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Writes rows as CSV (with a byte-order mark so Excel reads UTF-8 names correctly). */
export function toCsv(rows: Array<Array<string | number | boolean | null | undefined>>): string {
  return '﻿' + rows.map((r) => r.map((v) => quote(v === null || v === undefined ? '' : String(v))).join(',')).join('\r\n') + '\r\n';
}

/**
 * A phone number as WhatsApp digits (country code + number), or null if it doesn't look like one.
 * Numbers without a country code get `defaultCountryCode`; a leading 0 (trunk prefix) is dropped.
 */
export function normalizePhone(raw: string, defaultCountryCode = ''): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (defaultCountryCode) {
    const cc = defaultCountryCode.replace(/\D/g, '');
    if (!(digits.startsWith(cc) && digits.length > cc.length + 8)) digits = cc + digits.replace(/^0+/, '');
  }
  digits = digits.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export interface CsvContacts {
  /** Column headers (or "Column 1"... when the file has none). */
  columns: string[];
  phoneColumn: number;
  nameColumn: number;
  rows: string[][];
}

/** Finds the phone and name columns in a CSV with or without a header row. */
export function detectColumns(rows: string[][]): CsvContacts {
  const first = rows[0] ?? [];
  const looksLikePhone = (v: string) => /^[+\d][\d\s().-]{6,}$/.test(v.trim());
  const hasHeader = first.length > 0 && !first.some(looksLikePhone);
  const columns = hasHeader ? first.map((h, i) => h.trim() || `Column ${i + 1}`) : first.map((_, i) => `Column ${i + 1}`);
  const data = hasHeader ? rows.slice(1) : rows;
  const byName = (pattern: RegExp) => columns.findIndex((c) => pattern.test(c));
  let phoneColumn = byName(/phone|mobile|whats ?app|number|cell|tel/i);
  if (phoneColumn < 0) {
    const sample = data.slice(0, 20);
    phoneColumn = columns.findIndex((_, i) => sample.filter((r) => looksLikePhone(r[i] ?? '')).length > sample.length / 2);
  }
  let nameColumn = byName(/^(full ?)?name$|first ?name|contact|customer/i);
  if (nameColumn < 0 || nameColumn === phoneColumn) nameColumn = columns.findIndex((_, i) => i !== phoneColumn);
  return { columns, phoneColumn, nameColumn, rows: data };
}
