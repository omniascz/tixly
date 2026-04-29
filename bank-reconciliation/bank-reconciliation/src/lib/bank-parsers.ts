/**
 * Bank Statement Parsers — ABO, CSV, MT940
 * Prevzato z @acc/accounting bank-parsers.ts a adaptovano pro Tixly.
 *
 * Hlavni zmeny oproti accounting verzi:
 * - Bez Decimal.js (Tixly pouziva integer halire, neni potreba libovolna presnost)
 * - amount je vzdy string (decimal) pro konzistenci s ruznymi menami
 * - Tixly-specificky: CSV presety pro ceske banky
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ParsedTransaction {
  externalId?: string;
  bookingDate: string;       // YYYY-MM-DD
  valueDate?: string;        // YYYY-MM-DD
  amount: string;            // Decimal string, kladne = prijem, zaporne = vydaj
  currency: string;          // ISO 4217
  direction: 'credit' | 'debit';
  counterpartyName?: string;
  counterpartyAccount?: string;
  counterpartyIban?: string;
  variableSymbol?: string;
  constantSymbol?: string;
  specificSymbol?: string;
  description?: string;
  reference?: string;
  rawLine?: string;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  accountNumber?: string;
  iban?: string;
  currency?: string;
  openingBalance?: string;
  closingBalance?: string;
  periodFrom?: string;
  periodTo?: string;
  errors: Array<{ line: number; message: string }>;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function aboDateToIso(ddmmyy: string): string | null {
  if (ddmmyy.length !== 6 || !/^\d{6}$/.test(ddmmyy)) return null;
  const dd = ddmmyy.slice(0, 2);
  const mm = ddmmyy.slice(2, 4);
  const yy = ddmmyy.slice(4, 6);
  const year = parseInt(yy, 10) < 50 ? `20${yy}` : `19${yy}`;
  return `${year}-${mm}-${dd}`;
}

function mt940DateToIso(yymmdd: string): string {
  if (yymmdd.length !== 6) return yymmdd;
  const yy = yymmdd.slice(0, 2);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const year = parseInt(yy, 10) < 50 ? `20${yy}` : `19${yy}`;
  return `${year}-${mm}-${dd}`;
}

function parseDate(dateStr: string, fmt: string): string {
  const s = dateStr.trim();
  const f = fmt.toUpperCase();

  if (f === 'DD.MM.YYYY' || f === 'D.M.YYYY') {
    const parts = s.split('.');
    if (parts.length === 3) {
      const [d, m, y] = parts;
      return `${y}-${(m ?? '').padStart(2, '0')}-${(d ?? '').padStart(2, '0')}`;
    }
  }
  if (f === 'YYYY-MM-DD') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  if (f === 'MM/DD/YYYY') {
    const parts = s.split('/');
    if (parts.length === 3) {
      const [m, d, y] = parts;
      return `${y}-${(m ?? '').padStart(2, '0')}-${(d ?? '').padStart(2, '0')}`;
    }
  }
  // Fallback
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
    const [d, m, y] = s.split('.');
    return `${y}-${m}-${d}`;
  }
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s)) {
    const parts = s.split('.');
    const [d, m, y] = parts;
    return `${y}-${(m ?? '').padStart(2, '0')}-${(d ?? '').padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s;
}

function emptyResult(): ParseResult {
  return { transactions: [], errors: [] };
}

// ---------------------------------------------------------------------------
// ABO Parser (cesky KPC/GPC format, 128 znaku na radek)
// ---------------------------------------------------------------------------

export function parseAbo(content: string): ParseResult {
  const result = emptyResult();
  const lines = content.split(/\r?\n/);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx] ?? '';
    const line = raw.padEnd(128, ' ');
    if (line.trim().length === 0) continue;

    const recordType = line.slice(0, 3);

    try {
      if (recordType === '074') {
        const accountNum = line.slice(3, 19).trim();
        const bankCode = line.slice(19, 23).trim();
        const currency = line.slice(23, 29).trim();
        const dateFrom = line.slice(29, 35).trim();
        const dateTo = line.slice(35, 41).trim();

        if (accountNum) {
          result.accountNumber = bankCode ? `${accountNum}/${bankCode}` : accountNum;
        }
        if (currency) result.currency = currency;
        if (dateFrom && dateFrom !== '000000') {
          const iso = aboDateToIso(dateFrom);
          if (iso) result.periodFrom = iso;
        }
        if (dateTo && dateTo !== '000000') {
          const iso = aboDateToIso(dateTo);
          if (iso) result.periodTo = iso;
        }

        const openingRaw = line.slice(41, 57).trim();
        const openingSign = line.slice(57, 58).trim();
        if (openingRaw) {
          const centAmount = parseInt(openingRaw, 10);
          if (!isNaN(centAmount)) {
            const amount = centAmount / 100;
            result.openingBalance = (openingSign === '-' ? -amount : amount).toFixed(2);
          }
        }
      } else if (recordType === '075') {
        const dateStr = line.slice(3, 9).trim();
        const movementNum = line.slice(9, 22).trim();
        const counterAccount = line.slice(22, 38).trim();
        const counterBankCode = line.slice(38, 42).trim();
        const constantSymbol = line.slice(42, 52).trim();
        const variableSymbol = line.slice(52, 62).trim();
        const specificSymbol = line.slice(62, 72).trim();
        const userIdentification = line.slice(72, 92).trim();
        const sign = line.slice(93, 94).trim();
        const amountRaw = line.slice(94, 106).trim();
        const valueDateStr = line.slice(106, 112).trim();
        const description = line.slice(113, 133).trim();

        const centAmount = parseInt(amountRaw || '0', 10);
        if (isNaN(centAmount)) {
          result.errors.push({ line: lineIdx + 1, message: `Invalid amount: "${amountRaw}"` });
          continue;
        }

        const isDebit = sign === '-';
        const absAmount = centAmount / 100;
        const amount = isDebit ? -absAmount : absAmount;
        const bookingDate = dateStr && dateStr !== '000000' ? aboDateToIso(dateStr) : null;
        const valueDate = valueDateStr && valueDateStr !== '000000'
          ? (aboDateToIso(valueDateStr) ?? undefined)
          : undefined;

        if (!bookingDate) {
          result.errors.push({ line: lineIdx + 1, message: 'Missing or invalid booking date' });
          continue;
        }

        result.transactions.push({
          externalId: movementNum || undefined,
          bookingDate: bookingDate!,
          valueDate,
          amount: amount.toFixed(2),
          currency: result.currency ?? 'CZK',
          direction: isDebit ? 'debit' : 'credit',
          counterpartyAccount:
            counterAccount && counterBankCode
              ? `${counterAccount}/${counterBankCode}`
              : counterAccount || undefined,
          variableSymbol: variableSymbol || undefined,
          constantSymbol: constantSymbol || undefined,
          specificSymbol: specificSymbol || undefined,
          description: description || (userIdentification ? userIdentification : undefined),
          rawLine: raw,
        });
      } else if (recordType === '076') {
        const closingRaw = line.slice(9, 25).trim();
        const closingSign = line.slice(25, 26).trim();
        if (closingRaw) {
          const centAmount = parseInt(closingRaw, 10);
          if (!isNaN(centAmount)) {
            const amount = centAmount / 100;
            result.closingBalance = (closingSign === '-' ? -amount : amount).toFixed(2);
          }
        }
      }
    } catch (err) {
      result.errors.push({
        line: lineIdx + 1,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// CSV Parser
// ---------------------------------------------------------------------------

export interface CsvParseOptions {
  delimiter?: string;
  dateColumn?: string;
  amountColumn?: string;
  descriptionColumn?: string;
  variableSymbolColumn?: string;
  counterpartyColumn?: string;
  counterpartyAccountColumn?: string;
  dateFormat?: string;
  currency?: string;
  skipRows?: number;
  preset?: 'fio' | 'csob' | 'kb' | 'cs' | 'rb' | 'moneta' | 'generic';
}

export const CSV_PRESETS: Record<string, CsvParseOptions> = {
  fio: {
    delimiter: ';',
    dateColumn: 'Datum',
    amountColumn: 'Objem',
    descriptionColumn: 'Zpráva pro příjemce',
    variableSymbolColumn: 'VS',
    counterpartyColumn: 'Název protiúčtu',
    counterpartyAccountColumn: 'Číslo protiúčtu',
    dateFormat: 'DD.MM.YYYY',
    currency: 'CZK',
  },
  csob: {
    delimiter: ';',
    skipRows: 2,
    dateColumn: 'Datum splatnosti',
    amountColumn: 'Částka',
    descriptionColumn: 'Popis transakce',
    counterpartyColumn: 'Název protistrany',
    counterpartyAccountColumn: 'Číslo účtu protistrany',
    dateFormat: 'DD.MM.YYYY',
    currency: 'CZK',
  },
  kb: {
    delimiter: ';',
    skipRows: 3,
    dateColumn: 'Datum splatnosti',
    amountColumn: 'Částka (CZK)',
    descriptionColumn: 'Popis',
    variableSymbolColumn: 'VS',
    counterpartyColumn: 'Název příjemce/plátce',
    dateFormat: 'DD.MM.YYYY',
    currency: 'CZK',
  },
  cs: {
    delimiter: ';',
    skipRows: 1,
    dateColumn: 'Datum zaúčtování',
    amountColumn: 'Částka',
    descriptionColumn: 'Popis',
    variableSymbolColumn: 'Variabilní symbol',
    counterpartyColumn: 'Název protiúčtu',
    dateFormat: 'DD.MM.YYYY',
    currency: 'CZK',
  },
  rb: {
    delimiter: ';',
    skipRows: 0,
    dateColumn: 'Datum zaúčtování',
    amountColumn: 'Objem',
    descriptionColumn: 'Popis',
    variableSymbolColumn: 'VS',
    dateFormat: 'DD.MM.YYYY',
    currency: 'CZK',
  },
  moneta: {
    delimiter: ';',
    skipRows: 1,
    dateColumn: 'Datum',
    amountColumn: 'Částka',
    descriptionColumn: 'Popis',
    dateFormat: 'DD.MM.YYYY',
    currency: 'CZK',
  },
  generic: {
    delimiter: ',',
    dateFormat: 'YYYY-MM-DD',
    currency: 'CZK',
  },
};

function detectCsvDelimiter(firstLine: string): string {
  const counts: Record<string, number> = {
    ';': (firstLine.match(/;/g) ?? []).length,
    ',': (firstLine.match(/,/g) ?? []).length,
    '\t': (firstLine.match(/\t/g) ?? []).length,
  };
  let best = ',';
  let bestCount = 0;
  for (const [delim, count] of Object.entries(counts)) {
    if (count > bestCount) { bestCount = count; best = delim; }
  }
  return best;
}

function detectCsvDateFormat(sample: string): string {
  const s = sample.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'YYYY-MM-DD';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return 'MM/DD/YYYY';
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s)) return 'DD.MM.YYYY';
  return 'YYYY-MM-DD';
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function resolveColumn(headers: string[], colSpec: string | undefined): number {
  if (colSpec === undefined) return -1;
  const idx = headers.findIndex(
    (h) => h.trim().toLowerCase() === colSpec.trim().toLowerCase(),
  );
  if (idx !== -1) return idx;
  const n = parseInt(colSpec, 10);
  if (!isNaN(n) && n >= 0 && n < headers.length) return n;
  return -1;
}

function parseAmountStr(raw: string): number | null {
  let s = raw.replace(/\s/g, '').replace(/\u00A0/g, '');

  // Evropsky format: 1.234,56 -> 1234.56
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d+(,\d+)?$/.test(s)) {
    s = s.replace(',', '.');
  }
  s = s.replace(/[^\d.\-+]/g, '');
  if (!s || s === '-') return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

export function parseCsv(content: string, options?: CsvParseOptions): ParseResult {
  const result = emptyResult();

  let opts: CsvParseOptions = { ...(options ?? {}) };
  if (opts.preset && CSV_PRESETS[opts.preset]) {
    opts = { ...CSV_PRESETS[opts.preset], ...opts };
  }

  const rawLines = content.split(/\r?\n/);
  const skipRows = opts.skipRows ?? 0;
  let startIdx = 0;

  while (startIdx < rawLines.length && (rawLines[startIdx] ?? '').trim() === '') {
    startIdx++;
  }
  startIdx += skipRows;

  const usefulLines = rawLines.slice(startIdx);
  let headerIdx = 0;
  while (headerIdx < usefulLines.length && (usefulLines[headerIdx] ?? '').trim() === '') {
    headerIdx++;
  }

  if (headerIdx >= usefulLines.length) {
    result.errors.push({ line: 0, message: 'No data found in CSV' });
    return result;
  }

  const headerLine = usefulLines[headerIdx] ?? '';
  const delimiter = opts.delimiter ?? detectCsvDelimiter(headerLine);
  const headers = splitCsvLine(headerLine, delimiter);

  const dateColIdx = resolveColumn(headers, opts.dateColumn);
  const amountColIdx = resolveColumn(headers, opts.amountColumn);
  const descColIdx = resolveColumn(headers, opts.descriptionColumn);
  const vsColIdx = resolveColumn(headers, opts.variableSymbolColumn);
  const counterColIdx = resolveColumn(headers, opts.counterpartyColumn);
  const counterAccColIdx = resolveColumn(headers, opts.counterpartyAccountColumn);

  let dateFormat = opts.dateFormat ?? '';

  for (let i = headerIdx + 1; i < usefulLines.length; i++) {
    const rawLine = usefulLines[i] ?? '';
    if (rawLine.trim() === '') continue;

    const lineNum = startIdx + i + 1;

    try {
      const cells = splitCsvLine(rawLine, delimiter);

      let bookingDate = '';
      if (dateColIdx >= 0) {
        const dateRaw = (cells[dateColIdx] ?? '').trim();
        if (!dateFormat && dateRaw) dateFormat = detectCsvDateFormat(dateRaw);
        bookingDate = parseDate(dateRaw, dateFormat || 'YYYY-MM-DD');
      }

      if (!bookingDate) {
        result.errors.push({ line: lineNum, message: 'Missing or unparseable date' });
        continue;
      }

      const amountRaw = amountColIdx >= 0 ? (cells[amountColIdx] ?? '') : '';
      const amountNum = parseAmountStr(amountRaw);

      if (amountNum === null) {
        result.errors.push({ line: lineNum, message: `Invalid amount: "${amountRaw}"` });
        continue;
      }

      const isDebit = amountNum < 0;

      result.transactions.push({
        bookingDate,
        amount: amountNum.toFixed(2),
        currency: opts.currency ?? 'CZK',
        direction: isDebit ? 'debit' : 'credit',
        description: descColIdx >= 0 ? (cells[descColIdx] ?? '').trim() || undefined : undefined,
        variableSymbol: vsColIdx >= 0 ? (cells[vsColIdx] ?? '').trim() || undefined : undefined,
        counterpartyName: counterColIdx >= 0 ? (cells[counterColIdx] ?? '').trim() || undefined : undefined,
        counterpartyAccount: counterAccColIdx >= 0 ? (cells[counterAccColIdx] ?? '').trim() || undefined : undefined,
        rawLine,
      });
    } catch (err) {
      result.errors.push({
        line: lineNum,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// MT940 Parser (SWIFT format)
// ---------------------------------------------------------------------------

export function parseMt940(content: string): ParseResult {
  const result = emptyResult();
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  interface TagBlock { tag: string; content: string; startLine: number; }

  const blocks: TagBlock[] = [];
  const lines = normalized.split('\n');
  let currentTag: string | null = null;
  let currentContent: string[] = [];
  let currentStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = line.match(/^:(\d{2}[A-Z]?):(.*)/);
    if (match) {
      if (currentTag !== null) {
        blocks.push({ tag: currentTag, content: currentContent.join('\n').trimEnd(), startLine: currentStartLine });
      }
      currentTag = match[1] ?? '';
      currentContent = [match[2] ?? ''];
      currentStartLine = i + 1;
    } else if (currentTag !== null) {
      currentContent.push(line);
    }
  }
  if (currentTag !== null) {
    blocks.push({ tag: currentTag, content: currentContent.join('\n').trimEnd(), startLine: currentStartLine });
  }

  let pendingTxn: Partial<ParsedTransaction> | null = null;

  for (const block of blocks) {
    try {
      switch (block.tag) {
        case '25': {
          const acct = block.content.trim();
          if (/^[A-Z]{2}\d/.test(acct)) result.iban = acct;
          else result.accountNumber = acct;
          break;
        }

        case '60F':
        case '60M': {
          const m = block.content.trim().match(/^([DC])(\d{6})([A-Z]{3})([\d,]+)/);
          if (m) {
            const dcSign = m[1];
            const dateStr = m[2] ?? '';
            const currency = m[3];
            const amtStr = (m[4] ?? '').replace(',', '.');
            result.currency = currency;
            result.periodFrom = mt940DateToIso(dateStr);
            const amt = Number(amtStr);
            result.openingBalance = (dcSign === 'D' ? -amt : amt).toFixed(2);
          }
          break;
        }

        case '62F':
        case '62M': {
          const m = block.content.trim().match(/^([DC])(\d{6})([A-Z]{3})([\d,]+)/);
          if (m) {
            const dcSign = m[1];
            const dateStr = m[2] ?? '';
            const currency = m[3];
            const amtStr = (m[4] ?? '').replace(',', '.');
            if (!result.currency) result.currency = currency;
            result.periodTo = mt940DateToIso(dateStr);
            const amt = Number(amtStr);
            result.closingBalance = (dcSign === 'D' ? -amt : amt).toFixed(2);
          }
          break;
        }

        case '61': {
          if (pendingTxn?.bookingDate) {
            result.transactions.push(pendingTxn as ParsedTransaction);
          }
          pendingTxn = null;

          const raw = block.content.trim();
          let valueDateRaw: string | undefined;
          let bookDateRaw: string | undefined;
          let dcIndicator: string | undefined;
          let amtStr: string | undefined;
          let refPart = '';

          const m61WithBD = raw.match(/^(\d{6})(\d{4})([DC][A-Z]?)(\d+,\d{2})(.*)/);
          const m61NoBD = raw.match(/^(\d{6})([DC][A-Z]?)(\d+,\d{2})(.*)/);

          if (m61WithBD) {
            valueDateRaw = m61WithBD[1];
            bookDateRaw = m61WithBD[2];
            dcIndicator = m61WithBD[3];
            amtStr = (m61WithBD[4] ?? '').replace(',', '.');
            refPart = (m61WithBD[5] ?? '').trim();
          } else if (m61NoBD) {
            valueDateRaw = m61NoBD[1];
            dcIndicator = m61NoBD[2];
            amtStr = (m61NoBD[3] ?? '').replace(',', '.');
            refPart = (m61NoBD[4] ?? '').trim();
          } else {
            result.errors.push({ line: block.startLine, message: `Cannot parse :61: field: "${raw}"` });
            break;
          }

          const valueDate = mt940DateToIso(valueDateRaw ?? '');
          let bookingDate = valueDate;
          if (bookDateRaw && bookDateRaw.length === 4) {
            const year = valueDate.slice(0, 4);
            bookingDate = `${year}-${bookDateRaw.slice(0, 2)}-${bookDateRaw.slice(2, 4)}`;
          }

          const isDebit = (dcIndicator ?? '').charAt(0) === 'D';
          const amt = Number(amtStr ?? '0');
          const amount = isDebit ? -amt : amt;

          let reference: string | undefined;
          const refMatch = refPart.match(/\/\/([^\n]+)/);
          if (refMatch) reference = refMatch[1]?.trim() || undefined;

          pendingTxn = {
            bookingDate,
            valueDate,
            amount: amount.toFixed(2),
            currency: result.currency ?? 'EUR',
            direction: isDebit ? 'debit' : 'credit',
            reference,
            rawLine: raw,
          };
          break;
        }

        case '86': {
          const narrative = block.content.trim();
          if (pendingTxn) {
            pendingTxn.description = narrative;

            const vsMatch = narrative.match(/\/VS\/(\d+)/i);
            const ksMatch = narrative.match(/\/KS\/(\d+)/i);
            const ssMatch = narrative.match(/\/SS\/(\d+)/i);
            const nameMatch = narrative.match(/\/NAME\/([^/\n]+)/i);
            const acctMatch = narrative.match(/\/ACC\/([^/\n]+)/i);

            if (vsMatch) pendingTxn.variableSymbol = vsMatch[1];
            if (ksMatch) pendingTxn.constantSymbol = ksMatch[1];
            if (ssMatch) pendingTxn.specificSymbol = ssMatch[1];
            if (nameMatch) pendingTxn.counterpartyName = nameMatch[1]?.trim();
            if (acctMatch) pendingTxn.counterpartyAccount = acctMatch[1]?.trim();

            if (pendingTxn.bookingDate) {
              result.transactions.push(pendingTxn as ParsedTransaction);
            }
            pendingTxn = null;
          }
          break;
        }
      }
    } catch (err) {
      result.errors.push({
        line: block.startLine,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (pendingTxn?.bookingDate) {
    result.transactions.push(pendingTxn as ParsedTransaction);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Format detection + universal parser
// ---------------------------------------------------------------------------

export function detectBankFormat(content: string): 'abo' | 'mt940' | 'csv' | 'unknown' {
  const trimmed = content.trimStart();

  if (trimmed.startsWith('074') || trimmed.startsWith('075')) return 'abo';

  const firstLines = trimmed.split(/\r?\n/).slice(0, 5);
  const aboLike = firstLines.some(
    (l) => l.length >= 3 && (l.startsWith('074') || l.startsWith('075') || l.startsWith('076')),
  );
  if (aboLike) return 'abo';

  if (/:20:/.test(trimmed) || /:60F:/.test(trimmed) || /:62F:/.test(trimmed) || /:61:/.test(trimmed)) {
    return 'mt940';
  }

  const nonEmptyLines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length > 0) {
    const line = nonEmptyLines[0] ?? '';
    if (line.includes(';') || line.includes(',') || line.includes('\t')) return 'csv';
  }

  return 'unknown';
}

export function parseBankStatement(content: string, options?: CsvParseOptions): ParseResult {
  const format = detectBankFormat(content);
  switch (format) {
    case 'abo': return parseAbo(content);
    case 'mt940': return parseMt940(content);
    case 'csv': return parseCsv(content, options);
    default: {
      const result = emptyResult();
      result.errors.push({ line: 0, message: 'Unknown bank statement format' });
      return result;
    }
  }
}
