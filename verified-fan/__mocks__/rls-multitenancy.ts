// Mock for @tixly/rls-multitenancy — passes db through without RLS context
export interface DbAdapter {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export async function withTenantContext<T>(
  db: DbAdapter,
  _context: Record<string, unknown>,
  fn: (db: DbAdapter) => Promise<T>,
): Promise<T> {
  return fn(db);
}
