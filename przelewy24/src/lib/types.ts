// Przelewy24 — typy a rozhraní
// Polska platební brána. Všechny částky v groszích (1 PLN = 100 groszy).

export type P24PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded';

export interface P24Transaction {
  sessionId: string;     // náš interní ID objednávky
  token: string;         // P24 token pro přesměrování
  redirectUrl: string;   // URL pro přesměrování kupujícího
  amount: number;        // v groszích
  currency: 'PLN';
  status: P24PaymentStatus;
  p24OrderId: string | null;
  createdAt: string;
}

export interface P24WebhookPayload {
  merchantId: number;
  posId: number;
  sessionId: string;
  amount: number;
  originAmount: number;
  currency: string;
  orderId: number;
  methodId: number;
  statement: string;
  sign: string;
}

export interface P24Config {
  merchantId: number;
  posId: number;
  apiKey: string;         // CRC klíč pro podpisy
  reportKey: string;      // klíč pro webhook ověření
  sandbox: boolean;
  returnUrl: string;      // URL po platbě
  notifyUrl: string;      // webhook URL
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export interface HttpClient {
  post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T>;
  put<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T>;
  get<T>(url: string, headers?: Record<string, string>): Promise<T>;
}

// Chyby
export class P24Error extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'P24Error';
  }
}

export class P24TransactionNotFoundError extends P24Error {
  constructor(sessionId: string) {
    super(`Przelewy24 transaction not found: ${sessionId}`, 'NOT_FOUND');
  }
}

export class P24SignatureError extends P24Error {
  constructor() {
    super('Invalid Przelewy24 webhook signature', 'INVALID_SIGNATURE');
  }
}

export class P24PaymentFailedError extends P24Error {
  constructor(sessionId: string) {
    super(`Przelewy24 payment failed for session: ${sessionId}`, 'PAYMENT_FAILED');
  }
}
