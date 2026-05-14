/**
 * Fio Bank — Open API client.
 *
 * Docs: https://www.fio.cz/docs/cz/API_Bankovnictvi.pdf
 *
 * Endpoints:
 *   - GET /ib_api/rest/last/{token}/transactions.json
 *       → vrátí transakce od posledního „set last id" call
 *   - POST /ib_api/rest/set-last-id/{token}/{id}/
 *       → server-side marker pozice (idempotent next-pull)
 *   - GET /ib_api/rest/periods/{token}/{date_from}/{date_to}/transactions.json
 *       → fallback pro range
 *
 * Token = read-only z Fio internet bankingu (User → API → Vygenerovat token).
 * Rate limit: 1 request / 30 s per token.
 */

const FIO_API_BASE = 'https://fioapi.fio.cz/v1';

export interface FioTransaction {
  id: string; // column22.value (transaction id)
  date: string; // column0.value (YYYY-MM-DD)
  amountHalire: number; // column1.value × 100
  currency: string; // column14.value
  payerName: string | null; // column10.value
  payerAccount: string | null; // column2.value + '/' + column3.value
  variableSymbol: string | null; // column5.value
  constantSymbol: string | null; // column4.value
  specificSymbol: string | null; // column6.value
  message: string | null; // column16.value
  typeText: string | null; // column8.value
}

interface FioColumnValue<T = string | number> {
  value: T;
  name?: string;
  id?: number;
}

interface FioRawTransaction {
  column22?: FioColumnValue;
  column0?: FioColumnValue;
  column1?: FioColumnValue<number>;
  column14?: FioColumnValue;
  column10?: FioColumnValue;
  column2?: FioColumnValue;
  column3?: FioColumnValue;
  column4?: FioColumnValue;
  column5?: FioColumnValue;
  column6?: FioColumnValue;
  column16?: FioColumnValue;
  column8?: FioColumnValue;
}

interface FioApiResponse {
  accountStatement: {
    info: {
      accountId: string;
      bankId: string;
      currency: string;
      iban?: string;
      dateStart?: string;
      dateEnd?: string;
      idList?: number;
    };
    transactionList?: { transaction?: FioRawTransaction[] };
  };
}

function parseTransaction(raw: FioRawTransaction): FioTransaction | null {
  const id = raw.column22?.value;
  const date = raw.column0?.value;
  const amountKc = raw.column1?.value;
  if (id === undefined || date === undefined || amountKc === undefined) return null;

  const payerAcc = raw.column2?.value;
  const payerBank = raw.column3?.value;

  return {
    id: String(id),
    date: String(date).slice(0, 10),
    amountHalire: Math.round(Number(amountKc) * 100),
    currency: String(raw.column14?.value ?? 'CZK'),
    payerName: raw.column10?.value ? String(raw.column10.value) : null,
    payerAccount: payerAcc ? `${payerAcc}${payerBank ? '/' + payerBank : ''}` : null,
    variableSymbol: raw.column5?.value ? String(raw.column5.value) : null,
    constantSymbol: raw.column4?.value ? String(raw.column4.value) : null,
    specificSymbol: raw.column6?.value ? String(raw.column6.value) : null,
    message: raw.column16?.value ? String(raw.column16.value) : null,
    typeText: raw.column8?.value ? String(raw.column8.value) : null,
  };
}

/**
 * Vrátí nové transakce od posledního „set last id" call. Server-side marker
 * je idempotentní — opakovaný call vrátí ZÁSILKU od poslední pozice.
 *
 * Pro initial sync použij fetchByPeriod() s explicit date range.
 */
export async function fetchLastFioTransactions(token: string): Promise<{
  transactions: FioTransaction[];
  iban: string | null;
  idList: number | null;
}> {
  const res = await fetch(`${FIO_API_BASE}/rest/last/${token}/transactions.json`);
  if (!res.ok) {
    throw new Error(`Fio API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const j = (await res.json()) as FioApiResponse;
  const raw = j.accountStatement.transactionList?.transaction ?? [];
  const transactions = raw
    .map((r) => parseTransaction(r))
    .filter((t): t is FioTransaction => t !== null);
  return {
    transactions,
    iban: j.accountStatement.info.iban ?? null,
    idList: j.accountStatement.info.idList ?? null,
  };
}

/**
 * Fetch range — pro initial sync nebo dohledávání.
 */
export async function fetchFioByPeriod(
  token: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ transactions: FioTransaction[]; iban: string | null }> {
  const res = await fetch(
    `${FIO_API_BASE}/rest/periods/${token}/${dateFrom}/${dateTo}/transactions.json`,
  );
  if (!res.ok) {
    throw new Error(`Fio API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const j = (await res.json()) as FioApiResponse;
  const raw = j.accountStatement.transactionList?.transaction ?? [];
  return {
    transactions: raw
      .map((r) => parseTransaction(r))
      .filter((t): t is FioTransaction => t !== null),
    iban: j.accountStatement.info.iban ?? null,
  };
}

/**
 * Posune server-side „last id" marker (idempotent next-pull state).
 */
export async function setFioLastId(token: string, id: number): Promise<void> {
  const res = await fetch(`${FIO_API_BASE}/rest/set-last-id/${token}/${id}/`);
  if (!res.ok && res.status !== 200) {
    throw new Error(`Fio set-last-id HTTP ${res.status}`);
  }
}
