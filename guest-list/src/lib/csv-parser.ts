// ---------------------------------------------------------------------------
// CSV Parser — parse guest list from CSV files
// ---------------------------------------------------------------------------

export class GuestListCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuestListCsvError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export interface ParsedGuestRow {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

/**
 * Parses a CSV string and returns an array of guest rows.
 *
 * Expected CSV format:
 *   firstName,lastName,email,phone
 *   John,Doe,john@example.com,+420123456789
 *
 * RFC 4180 minimal support:
 * - Handles quoted strings with commas/newlines inside
 * - Supports CRLF and LF line endings
 * - Header row validation (firstName, lastName required)
 *
 * @throws GuestListCsvError if CSV is invalid or missing required columns
 */
export function parseGuestCsv(content: string): ParsedGuestRow[] {
  if (!content || content.trim().length === 0) {
    throw new GuestListCsvError('CSV content cannot be empty.');
  }

  // Normalize line endings to LF
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');

  if (lines.length === 0) {
    throw new GuestListCsvError('CSV content is empty.');
  }

  // Parse header row
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);

  const firstNameIdx = headers.indexOf('firstName');
  const lastNameIdx = headers.indexOf('lastName');
  const emailIdx = headers.indexOf('email');
  const phoneIdx = headers.indexOf('phone');

  if (firstNameIdx === -1 || lastNameIdx === -1) {
    throw new GuestListCsvError(
      'CSV must have columns: firstName, lastName (email and phone are optional).',
    );
  }

  // Parse data rows
  const rows: ParsedGuestRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue; // Skip empty lines

    const cells = parseCSVLine(line);
    if (cells.length === 0) continue;

    const firstName = (cells[firstNameIdx] || '').trim();
    const lastName = (cells[lastNameIdx] || '').trim();
    const email = emailIdx !== -1 ? (cells[emailIdx] || '').trim() : undefined;
    const phone = phoneIdx !== -1 ? (cells[phoneIdx] || '').trim() : undefined;

    if (!firstName || !lastName) {
      throw new GuestListCsvError(
        `Row ${i + 1}: firstName and lastName are required. Found: "${firstName}", "${lastName}".`,
      );
    }

    rows.push({
      firstName,
      lastName,
      ...(email && { email }),
      ...(phone && { phone }),
    });
  }

  if (rows.length === 0) {
    throw new GuestListCsvError('CSV contains only a header row.');
  }

  return rows;
}

/**
 * Parses a single CSV line, handling quoted values with commas inside.
 *
 * Example:
 *   simple,line,here → ['simple', 'line', 'here']
 *   "quoted,value",regular → ['quoted,value', 'regular']
 */
function parseCSVLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote: "" → "
        current += '"';
        i++; // Skip the next quote
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of cell
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}
