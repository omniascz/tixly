/**
 * @tixly/db-adapter
 *
 * Canonical DbAdapter interface shared across all Tixly platform modules.
 *
 * Provides a database-agnostic abstraction that can be backed by postgres.js,
 * node-postgres (pg), or a test double — without leaking driver details into
 * business logic.
 *
 * @example
 * import type { DbAdapter } from '@tixly/db-adapter';
 *
 * export interface ServiceDeps {
 *   db: DbAdapter;
 * }
 */

/**
 * Databázový adapter — abstrakce nad konkrétní DB knihovnou.
 * Implementován jako interface pro snadné mockování v testech
 * a výměnu DB driveru bez změny business logiky.
 */
export interface DbAdapter {
  /**
   * Provede SELECT dotaz a vrátí pole výsledků.
   * @param sql    Parametrizovaný SQL dotaz (použij $1, $2, ...)
   * @param params Hodnoty pro parametry
   */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * Provede INSERT/UPDATE/DELETE bez návratové hodnoty.
   * @param sql    Parametrizovaný SQL dotaz
   * @param params Hodnoty pro parametry
   */
  execute(sql: string, params?: unknown[]): Promise<void>;

  /**
   * Spustí funkci uvnitř databázové transakce.
   * Při úspěchu provede COMMIT, při chybě ROLLBACK.
   * @param fn Funkce která dostane DB adapter scoped na transakci
   */
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}
