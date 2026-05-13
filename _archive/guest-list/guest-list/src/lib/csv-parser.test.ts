// ---------------------------------------------------------------------------
// CSV Parser Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parseGuestCsv, GuestListCsvError } from './csv-parser.js';

describe('parseGuestCsv', () => {
  // =========================================================================
  // Valid CSV parsing
  // =========================================================================

  it('parses valid CSV with required columns (firstName, lastName)', () => {
    const csv = `firstName,lastName
John,Doe
Jane,Smith`;

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ firstName: 'John', lastName: 'Doe' });
    expect(result[1]).toEqual({ firstName: 'Jane', lastName: 'Smith' });
  });

  it('parses CSV with all columns (firstName, lastName, email, phone)', () => {
    const csv = `firstName,lastName,email,phone
John,Doe,john@example.com,+420123456789
Jane,Smith,jane@example.com,+420987654321`;

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: '+420123456789',
    });
    expect(result[1]).toEqual({
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@example.com',
      phone: '+420987654321',
    });
  });

  it('parses CSV with optional email column only', () => {
    const csv = `firstName,lastName,email
John,Doe,john@example.com
Jane,Smith,jane@example.com`;

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
    });
  });

  it('parses CSV with optional phone column only', () => {
    const csv = `firstName,lastName,phone
John,Doe,+420123456789
Jane,Smith,+420987654321`;

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      firstName: 'John',
      lastName: 'Doe',
      phone: '+420123456789',
    });
  });

  it('handles quoted values with commas inside', () => {
    const csv = `firstName,lastName,email
"John, Jr.",Doe,john@example.com
Jane,"Smith, PhD",jane@example.com`;

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      firstName: 'John, Jr.',
      lastName: 'Doe',
      email: 'john@example.com',
    });
    expect(result[1]).toEqual({
      firstName: 'Jane',
      lastName: 'Smith, PhD',
      email: 'jane@example.com',
    });
  });

  it('handles quoted values with escaped quotes inside', () => {
    const csv = `firstName,lastName
"John ""Jack""",Doe
Jane,Smith`;

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      firstName: 'John "Jack"',
      lastName: 'Doe',
    });
  });

  it('handles CRLF line endings', () => {
    const csv = `firstName,lastName\r\nJohn,Doe\r\nJane,Smith`;

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ firstName: 'John', lastName: 'Doe' });
  });

  it('skips empty rows', () => {
    const csv = `firstName,lastName
John,Doe

Jane,Smith

`;

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ firstName: 'John', lastName: 'Doe' });
    expect(result[1]).toEqual({ firstName: 'Jane', lastName: 'Smith' });
  });

  it('handles whitespace in values (trimmed)', () => {
    const csv = `firstName,lastName
  John  ,  Doe
Jane,Smith`;

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ firstName: 'John', lastName: 'Doe' });
  });

  it('omits empty optional columns', () => {
    const csv = `firstName,lastName,email,phone
John,Doe,,+420123456789
Jane,Smith,jane@example.com,`;

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      firstName: 'John',
      lastName: 'Doe',
      phone: '+420123456789',
    });
    expect(result[1]).toEqual({
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@example.com',
    });
  });

  // =========================================================================
  // Error cases — missing required columns
  // =========================================================================

  it('throws if firstName column is missing', () => {
    const csv = `lastName,email
Doe,john@example.com`;

    expect(() => parseGuestCsv(csv)).toThrow(GuestListCsvError);
    expect(() => parseGuestCsv(csv)).toThrow(/firstName/i);
  });

  it('throws if lastName column is missing', () => {
    const csv = `firstName,email
John,john@example.com`;

    expect(() => parseGuestCsv(csv)).toThrow(GuestListCsvError);
    expect(() => parseGuestCsv(csv)).toThrow(/lastName/i);
  });

  it('throws if both required columns are missing', () => {
    const csv = `email,phone
john@example.com,+420123456789`;

    expect(() => parseGuestCsv(csv)).toThrow(GuestListCsvError);
    expect(() => parseGuestCsv(csv)).toThrow(/firstName.*lastName/i);
  });

  // =========================================================================
  // Error cases — invalid data
  // =========================================================================

  it('throws if firstName is empty in a data row', () => {
    const csv = `firstName,lastName
,Doe`;

    expect(() => parseGuestCsv(csv)).toThrow(GuestListCsvError);
    expect(() => parseGuestCsv(csv)).toThrow(/required/i);
  });

  it('throws if lastName is empty in a data row', () => {
    const csv = `firstName,lastName
John,`;

    expect(() => parseGuestCsv(csv)).toThrow(GuestListCsvError);
    expect(() => parseGuestCsv(csv)).toThrow(/required/i);
  });

  it('throws if both firstName and lastName are empty', () => {
    const csv = `firstName,lastName
,`;

    expect(() => parseGuestCsv(csv)).toThrow(GuestListCsvError);
    expect(() => parseGuestCsv(csv)).toThrow(/required/i);
  });

  // =========================================================================
  // Error cases — empty input
  // =========================================================================

  it('throws if CSV body is empty string', () => {
    expect(() => parseGuestCsv('')).toThrow(GuestListCsvError);
    expect(() => parseGuestCsv('')).toThrow(/empty/i);
  });

  it('throws if CSV body is only whitespace', () => {
    expect(() => parseGuestCsv('   \n\n   ')).toThrow(GuestListCsvError);
    expect(() => parseGuestCsv('   \n\n   ')).toThrow(/empty/i);
  });

  it('throws if CSV contains only header row', () => {
    const csv = `firstName,lastName`;

    expect(() => parseGuestCsv(csv)).toThrow(GuestListCsvError);
    expect(() => parseGuestCsv(csv)).toThrow(/header/i);
  });

  it('throws if CSV contains only header and empty rows', () => {
    const csv = `firstName,lastName


`;

    expect(() => parseGuestCsv(csv)).toThrow(GuestListCsvError);
    expect(() => parseGuestCsv(csv)).toThrow(/header/i);
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  it('handles columns in any order', () => {
    const csv = `email,lastName,phone,firstName
john@example.com,Doe,+420123456789,John
jane@example.com,Smith,+420987654321,Jane`;

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: '+420123456789',
    });
  });

  it('handles quoted header values', () => {
    const csv = `"firstName","lastName","email"
John,Doe,john@example.com`;

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
    });
  });

  it('handles international names with diacritics', () => {
    const csv = `firstName,lastName
Dvořák,Novotný
François,Müller`;

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      firstName: 'Dvořák',
      lastName: 'Novotný',
    });
    expect(result[1]).toEqual({
      firstName: 'François',
      lastName: 'Müller',
    });
  });

  it('handles large batches (500 rows)', () => {
    const rows = ['firstName,lastName'];
    for (let i = 1; i <= 500; i++) {
      rows.push(`Guest${i},Person${i}`);
    }
    const csv = rows.join('\n');

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(500);
    expect(result[0]).toEqual({ firstName: 'Guest1', lastName: 'Person1' });
    expect(result[499]).toEqual({ firstName: 'Guest500', lastName: 'Person500' });
  });

  it('handles multiline quoted values', () => {
    const csv = `firstName,lastName
"John
Line2",Doe
Jane,Smith`;

    const result = parseGuestCsv(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      firstName: 'John\nLine2',
      lastName: 'Doe',
    });
  });
});
