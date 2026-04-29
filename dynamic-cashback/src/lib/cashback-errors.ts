// cashback-errors.ts — chybové třídy pro Dynamic Cashback modul.

export type CashbackErrorCode =
  | 'USER_NOT_FOUND'
  | 'INVALID_RATE'
  | 'RATE_CAP_EXCEEDED'
  | 'LEDGER_DUPLICATE';

const STATUS: Record<CashbackErrorCode, number> = {
  USER_NOT_FOUND: 404,
  INVALID_RATE: 400,
  RATE_CAP_EXCEEDED: 400,
  LEDGER_DUPLICATE: 409,
};

const DEFAULT_MESSAGES: Record<CashbackErrorCode, string> = {
  USER_NOT_FOUND: 'Uživatel nebyl nalezen.',
  INVALID_RATE: 'Neplatná sazba cashbacku.',
  RATE_CAP_EXCEEDED: 'Sazba cashbacku přesahuje povolený limit promotéra.',
  LEDGER_DUPLICATE:
    'Cashback pro tuto objednávku už byl zapsán (duplicitní transakce).',
};

export class CashbackError extends Error {
  public readonly code: CashbackErrorCode;
  public readonly statusCode: number;

  constructor(code: CashbackErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'CashbackError';
    this.code = code;
    this.statusCode = STATUS[code];
  }
}
