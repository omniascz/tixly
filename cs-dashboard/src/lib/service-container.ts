// Service container — standard dependency injection pattern.
// Concrete adapters (real DB, email, barcode) are wired here.
// Unit tests inject mock deps directly into service functions.

export interface CsDbAdapter {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: CsDbAdapter) => Promise<T>): Promise<T>;
}

export interface CsEmailAdapter {
  sendTicketPdf(to: string, ticketId: string, barcodeCode: string, pdfBase64: string): Promise<void>;
}

export interface CsDepsContainer {
  db: CsDbAdapter;
  email: CsEmailAdapter;
}

let _container: CsDepsContainer | null = null;

export function initServiceContainer(container: CsDepsContainer): void {
  _container = container;
}

export function getServiceContainer(): CsDepsContainer {
  if (!_container) {
    throw new Error('CS service container not initialised. Call initServiceContainer() at startup.');
  }
  return _container;
}
