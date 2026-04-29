/**
 * CSV handler for buyer blacklist import/export.
 *
 * Minimal RFC 4180 parser:
 *   - comma delimiter
 *   - CRLF or LF line endings
 *   - fields may be double-quoted; embedded quotes escaped as ""
 *   - embedded newlines inside quoted fields are preserved
 *
 * Required header columns (order-independent):
 *   identifier,type,reason,severity
 *
 * `type` must be one of: 'email' | 'phone' | 'identity_hash'
 * `severity` is a free-form string (e.g. 'low' | 'medium' | 'high').
 *
 * Use `.js` extension on relative imports from TS consumers.
 */

import type { BlacklistEntry } from '../types/blacklist.types.js';

export type BlacklistIdentifierType = 'email' | 'phone' | 'identity_hash';

export interface ParsedBlacklistRow {
  identifier: string;
  type: BlacklistIdentifierType;
  reason: string;
  severity: string;
}

export class CsvParseError extends Error {
  readonly code = 'CSV_PARSE_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

const REQUIRED_HEADERS = ['identifier', 'type', 'reason', 'severity'] as const;
const VALID_TYPES: ReadonlySet<string> = new Set(['email', 'phone', 'identity_hash']);

// ---------------------------------------------------------------------------
// Tokenizer — RFC 4180 minimal
// ---------------------------------------------------------------------------

function tokenize(content: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const ch = content[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      // swallow, handled on \n
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // Flush trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (inQuotes) {
    throw new CsvParseError('Unterminated quoted field in CSV input.');
  }

  // Drop fully-empty trailing rows
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a blacklist CSV string into typed rows.
 * Throws CsvParseError on malformed input or missing required columns.
 */
export function parseBlacklistCsv(content: string): ParsedBlacklistRow[] {
  if (!content || content.trim().length === 0) {
    throw new CsvParseError('CSV input is empty.');
  }

  const rows = tokenize(content);
  if (rows.length === 0) {
    throw new CsvParseError('CSV input contains no rows.');
  }

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const indexByName = new Map<string, number>();
  header.forEach((name, idx) => indexByName.set(name, idx));

  for (const required of REQUIRED_HEADERS) {
    if (!indexByName.has(required)) {
      throw new CsvParseError(`Missing required column: '${required}'.`);
    }
  }

  const iIdentifier = indexByName.get('identifier')!;
  const iType = indexByName.get('type')!;
  const iReason = indexByName.get('reason')!;
  const iSeverity = indexByName.get('severity')!;

  const out: ParsedBlacklistRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    // Skip blank lines
    if (cells.every((c) => c.trim() === '')) continue;

    const identifier = (cells[iIdentifier] ?? '').trim();
    const type = (cells[iType] ?? '').trim();
    const reason = (cells[iReason] ?? '').trim();
    const severity = (cells[iSeverity] ?? '').trim();

    if (!identifier) {
      throw new CsvParseError(`Row ${r + 1}: 'identifier' is empty.`);
    }
    if (!VALID_TYPES.has(type)) {
      throw new CsvParseError(
        `Row ${r + 1}: invalid 'type' value '${type}' (expected email|phone|identity_hash).`,
      );
    }
    if (!reason) {
      throw new CsvParseError(`Row ${r + 1}: 'reason' is empty.`);
    }

    out.push({
      identifier,
      type: type as BlacklistIdentifierType,
      reason,
      severity: severity || 'medium',
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function escapeCell(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serialize blacklist entries to CSV (RFC 4180, CRLF line endings).
 * Columns: identifier,type,reason,severity,scope,status,banned_at
 */
export function exportBlacklistCsv(entries: BlacklistEntry[]): string {
  const header = ['identifier', 'type', 'reason', 'severity', 'scope', 'status', 'banned_at'];
  const lines: string[] = [header.join(',')];

  for (const entry of entries) {
    const row = [
      escapeCell(entry.email),
      'email',
      escapeCell(entry.reason),
      'medium',
      escapeCell(entry.scope),
      escapeCell(entry.status),
      escapeCell(entry.bannedAt.toISOString()),
    ];
    lines.push(row.join(','));
  }

  return lines.join('\r\n') + '\r\n';
}
