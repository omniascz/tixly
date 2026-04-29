import { BankReconciliationError } from './bank-errors.js';
import type { FioTransaction } from '../types/bank.js';

export interface FioConfig {
  token: string;
  apiBaseUrl: string;
  isConfigured: boolean;
}

const DEFAULT_BASE_URL = 'https://fioapi.fio.cz/v1/rest';

export function loadFioConfig(): FioConfig {
  const token = process.env.FIO_TOKEN?.trim() || '';
  const apiBaseUrl = process.env.FIO_API_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return {
    token,
    apiBaseUrl,
    isConfigured: Boolean(token),
  };
}

interface FioColumn<T> {
  value: T;
  name: string;
  id: number;
}

interface FioRawTransaction {
  column0?: FioColumn<string>;
  column1?: FioColumn<number>;
  column2?: FioColumn<string>;
  column4?: FioColumn<string>;
  column5?: FioColumn<string>;
  column6?: FioColumn<string>;
  column7?: FioColumn<string>;
  column8?: FioColumn<string>;
  column10?: FioColumn<string>;
  column14?: FioColumn<string>;
  column16?: FioColumn<string>;
  column22?: FioColumn<number | string>;
  [key: string]: FioColumn<unknown> | undefined;
}

interface FioResponse {
  accountStatement?: {
    info?: Record<string, unknown>;
    transactionList?: {
      transaction?: FioRawTransaction[];
    };
  };
}

function mapTypeToEnum(value: string | null): FioTransaction['type'] {
  if (!value) return 'PRIJEM';
  const lower = value.toLowerCase();
  if (lower.includes('příjem') || lower.includes('prijem')) return 'PRIJEM';
  if (lower.includes('výdaj') || lower.includes('vydaj')) return 'VYDAJ';
  return value;
}

export function mapFioRawTransaction(raw: FioRawTransaction): FioTransaction {
  const amountKc = (raw.column1?.value as number | undefined) ?? 0;
  const amountHalire = Math.round(Math.abs(Number(amountKc)) * 100);
  const rawId = raw.column22?.value;
  const id = rawId !== undefined && rawId !== null ? String(rawId) : '';

  return {
    id,
    date: String(raw.column0?.value ?? '').slice(0, 10),
    amountHalire,
    currency: String(raw.column14?.value ?? 'CZK'),
    variableSymbol: (raw.column5?.value as string | undefined) || null,
    constantSymbol: (raw.column4?.value as string | undefined) || null,
    specificSymbol: (raw.column6?.value as string | undefined) || null,
    counterAccount: (raw.column2?.value as string | undefined) || null,
    counterAccountName: (raw.column10?.value as string | undefined) || null,
    message: (raw.column16?.value as string | undefined) || null,
    type: mapTypeToEnum((raw.column8?.value as string | undefined) || null),
  };
}

export class FioClient {
  constructor(private config: FioConfig) {}

  private assertConfigured(): void {
    if (!this.config.isConfigured) {
      throw new BankReconciliationError('FIO_NOT_CONFIGURED');
    }
  }

  private async doGet(url: string): Promise<FioResponse> {
    let res: Response;
    try {
      res = await fetch(url, { method: 'GET' });
    } catch (err) {
      throw new BankReconciliationError('FIO_API_ERROR', {
        reason: (err as Error).message,
      });
    }
    if (res.status === 401 || res.status === 403) {
      throw new BankReconciliationError('FIO_AUTH_FAILED', { status: res.status });
    }
    if (!res.ok) {
      throw new BankReconciliationError('FIO_API_ERROR', { status: res.status });
    }
    try {
      return (await res.json()) as FioResponse;
    } catch (err) {
      throw new BankReconciliationError('FIO_API_ERROR', {
        reason: 'Invalid JSON from Fio',
      });
    }
  }

  private parseResponse(data: FioResponse): FioTransaction[] {
    const list = data.accountStatement?.transactionList?.transaction ?? [];
    return list.map(mapFioRawTransaction).filter((t) => t.id);
  }

  async fetchTransactionsInRange(from: string, to: string): Promise<FioTransaction[]> {
    if (!this.config.isConfigured) {
      console.log('[bank-reconciliation] Fio not configured, returning empty');
      return [];
    }
    this.assertConfigured();
    const url = `${this.config.apiBaseUrl}/periods/${this.config.token}/${from}/${to}/transactions.json`;
    const data = await this.doGet(url);
    return this.parseResponse(data);
  }

  async fetchNewTransactions(): Promise<FioTransaction[]> {
    if (!this.config.isConfigured) {
      console.log('[bank-reconciliation] Fio not configured, returning empty');
      return [];
    }
    this.assertConfigured();
    const url = `${this.config.apiBaseUrl}/last/${this.config.token}/transactions.json`;
    const data = await this.doGet(url);
    return this.parseResponse(data);
  }

  async setLastId(transactionId: string): Promise<void> {
    if (!this.config.isConfigured) {
      console.log('[bank-reconciliation] Fio not configured, returning empty');
      return;
    }
    this.assertConfigured();
    const url = `${this.config.apiBaseUrl}/set-last-id/${this.config.token}/${transactionId}/`;
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST' });
    } catch (err) {
      throw new BankReconciliationError('FIO_API_ERROR', {
        reason: (err as Error).message,
      });
    }
    if (res.status === 401 || res.status === 403) {
      throw new BankReconciliationError('FIO_AUTH_FAILED', { status: res.status });
    }
    if (!res.ok) {
      throw new BankReconciliationError('FIO_API_ERROR', { status: res.status });
    }
  }
}
