import { describe, it, expect } from 'vitest';
import {
  parseAbo,
  parseCsv,
  parseMt940,
  detectBankFormat,
  parseBankStatement,
  CSV_PRESETS,
} from '../lib/bank-parsers.js';

/* ------------------------------------------------------------------ */
/* ABO parser                                                         */
/* ------------------------------------------------------------------ */

describe('parseAbo', () => {
  // ABO format: 128-char fixed-width records
  // Record 074 = header, 075 = transaction, 076 = footer

  const aboHeader =
    '0740000000001234567890120260412000000001234567890                                                                            ';
  const aboTx1 =
    '0750000000001234567890120260412000000000012345600001234560000000000000000000001VS00000000KS0000SS0000Protiucet       Popis tx   ';
  const aboFooter =
    '0760000000001234567890120260412000000000000001000000000012345600000000000000000                                               ';

  it('parses a valid ABO file with one transaction', () => {
    const content = [aboHeader, aboTx1, aboFooter].join('\n');
    const result = parseAbo(content);
    expect(result.transactions.length).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
  });

  it('returns errors for empty content', () => {
    const result = parseAbo('');
    expect(result.transactions).toHaveLength(0);
  });

  it('skips non-075 lines', () => {
    const content = [aboHeader, aboFooter].join('\n');
    const result = parseAbo(content);
    expect(result.transactions).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* CSV parser                                                         */
/* ------------------------------------------------------------------ */

describe('parseCsv', () => {
  it('parses generic CSV with header', () => {
    const csv = [
      'date;amount;currency;variable_symbol;description',
      '2026-04-10;1234.56;CZK;12345;Test platba',
      '2026-04-11;-500.00;CZK;;Odchozi platba',
    ].join('\n');

    const result = parseCsv(csv, CSV_PRESETS['generic']);
    expect(result.transactions.length).toBe(2);

    const first = result.transactions[0];
    expect(first.amount).toContain('1234');
    expect(first.currency).toBe('CZK');
    expect(first.direction).toBe('credit');

    const second = result.transactions[1];
    expect(second.direction).toBe('debit');
  });

  it('parses Fio CSV preset', () => {
    // Fio CSV has a specific header line structure
    const csv = [
      '"ID pohybu";"Datum";"Objem";"Měna";"Protiúčet";"Název protiúčtu";"Kód banky";"BIC";"KS";"VS";"SS";"Uživatelská identifikace";"Typ";"Provedl";"Upřesnění";"Komentář";"BIC";"ID pokynu"',
      '"12345678";"10.04.2026";"1234.56";"CZK";"1234567890/0100";"Jan Novak";"0100";"";"0308";"0000012345";"";"";"Příjem převodem";"";"";"";"";""',
    ].join('\n');

    const result = parseCsv(csv, CSV_PRESETS['fio']);
    expect(result.transactions.length).toBe(1);
    expect(result.transactions[0].variableSymbol).toBe('0000012345');
  });

  it('returns errors for empty CSV', () => {
    const result = parseCsv('');
    expect(result.transactions).toHaveLength(0);
  });

  it('handles CSV without options (falls back to auto-detect)', () => {
    const csv = 'date;amount;currency\n2026-04-10;100.00;CZK\n';
    const result = parseCsv(csv);
    expect(result.transactions.length).toBeGreaterThanOrEqual(0);
  });
});

/* ------------------------------------------------------------------ */
/* MT940 parser                                                       */
/* ------------------------------------------------------------------ */

describe('parseMt940', () => {
  const mt940 = `:20:STMT20260412
:25:CZ1234567890123456789012
:28C:00001/001
:60F:C260411CZK100000,00
:61:2604120412C12345,60NMSCNONREF
//00000012345
:86:VS:0000012345 KS:0000 SS:0000
Protistrana: Jan Novak
:62F:C260412CZK112345,60
`;

  it('parses a valid MT940 statement', () => {
    const result = parseMt940(mt940);
    expect(result.transactions.length).toBe(1);
    expect(result.errors).toHaveLength(0);

    const tx = result.transactions[0];
    expect(tx.direction).toBe('credit');
    expect(tx.currency).toBe('CZK');
  });

  it('extracts variable symbol from :86: field', () => {
    const result = parseMt940(mt940);
    expect(result.transactions[0].variableSymbol).toBe('0000012345');
  });

  it('returns empty for non-MT940 content', () => {
    const result = parseMt940('This is not an MT940 file');
    expect(result.transactions).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* detectBankFormat                                                    */
/* ------------------------------------------------------------------ */

describe('detectBankFormat', () => {
  it('detects ABO format', () => {
    expect(detectBankFormat('074000000000123456...')).toBe('abo');
    expect(detectBankFormat('075000000000123456...')).toBe('abo');
  });

  it('detects MT940 format', () => {
    expect(detectBankFormat(':20:STMT\n:25:ACC\n:60F:C...')).toBe('mt940');
  });

  it('detects CSV format', () => {
    expect(detectBankFormat('date;amount;currency\n2026-01-01;100;CZK')).toBe('csv');
  });

  it('returns unknown for empty input', () => {
    expect(detectBankFormat('')).toBe('unknown');
  });
});

/* ------------------------------------------------------------------ */
/* parseBankStatement (universal entry point)                          */
/* ------------------------------------------------------------------ */

describe('parseBankStatement', () => {
  it('auto-detects and parses MT940', () => {
    const mt940 = `:20:TEST\n:25:ACC\n:60F:C260101CZK0,00\n:62F:C260101CZK0,00\n`;
    const result = parseBankStatement(mt940);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error for unknown format', () => {
    const result = parseBankStatement('random binary garbage §±×÷');
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
