// =============================================================================
// Default rollback handlers
//
// - `noopRollbackHandler`: zaloguje se bez jakékoli aktivní restaurace (pouze audit).
// - `genericJsonRollbackHandler`: bezpečný generický UPDATE rollback, který
//   obnovuje hodnoty z `beforeState` zpět do databáze.
//
// BEZPEČNOST (P0 fix):
// ----------------------------------------------------------------------------
// Generický handler NESMÍ interpolovat jména tabulek ani sloupců pocházející
// z JSONB payloadu — to by umožňovalo SQL injection komukoli, kdo má oprávnění
// spouštět rollback. Místo toho handler konzultuje server-side registry, kam
// si moduly při bootu registrují své entity typy spolu se strict allowlistem
// povolených sloupců.
//
// BREAKING CHANGE: Každý modul, který chce používat `genericJsonRollbackHandler`,
// MUSÍ při inicializaci zavolat `registerRollbackTable(entityType, config)`.
// Pokud entity typ není registrovaný, handler odmítne akci s chybou NO_HANDLER.
//
// Příklad registrace (v modulu permanentky při bootstrap):
// ----------------------------------------------------------------------------
//   import { registerRollbackTable } from '@tixly/action-log';
//
//   registerRollbackTable('permanentky.client_package', {
//     tableName: 'permanentky.client_packages',
//     primaryKey: 'id',
//     allowedColumns: ['status', 'remaining_entries', 'valid_until', 'note'],
//   });
//
//   registerRollbackTable('reservation', {
//     tableName: 'reservations.reservations',
//     primaryKey: 'id',
//     allowedColumns: ['status', 'cancelled_at', 'cancelled_reason'],
//   });
// =============================================================================

import type { ActionLogEntry } from '../types/action.js';
import type { ServiceDeps } from './service-container.js';
import { ActionLogError } from './action-errors.js';

export type RollbackHandler = (
  action: ActionLogEntry,
  deps: ServiceDeps,
) => Promise<void>;

export const noopRollbackHandler: RollbackHandler = async () => {
  // Žádná akce — pouze audit trail.
  // Noop handler je bezpečný, nepracuje s payloadem ani s DB.
};

// ---------------------------------------------------------------------------
// Rollback table registry (server-controlled whitelist)
// ---------------------------------------------------------------------------

export interface RollbackTableConfig {
  /** Fully qualified table name e.g. "permanentky.client_packages" */
  tableName: string;
  /** Allowed primary key column (used in WHERE) */
  primaryKey: string;
  /** Allowed columns that can be restored */
  allowedColumns: string[];
}

const ROLLBACK_TABLE_REGISTRY = new Map<string, RollbackTableConfig>();

/** Register a rollbackable entity type with strict column allowlist */
export function registerRollbackTable(
  entityType: string,
  config: RollbackTableConfig,
): void {
  ROLLBACK_TABLE_REGISTRY.set(entityType, config);
}

/** Read-only access for tests / debugging */
export function getRegisteredRollbackTable(
  entityType: string,
): RollbackTableConfig | undefined {
  return ROLLBACK_TABLE_REGISTRY.get(entityType);
}

/** Pouze pro testy — vyčistí registry tabulek. */
export function _resetRollbackTableRegistryForTests(): void {
  ROLLBACK_TABLE_REGISTRY.clear();
}

// ---------------------------------------------------------------------------
// Generic JSON rollback handler (safe)
// ---------------------------------------------------------------------------

/**
 * Bezpečný generický rollback handler.
 *
 * - `tableName`, `primaryKey` a povolené sloupce pocházejí z REGISTRY
 *   (populated trusted module code at boot, ne uživatelským vstupem).
 * - Hodnoty z `beforeState` jsou bindovány jako parametry (`$1`, `$2`, ...),
 *   nikdy nejsou konkatenovány do SQL stringu.
 * - Jakýkoli klíč v `beforeState`, který není v `allowedColumns`, způsobí
 *   vyhození chyby PŘED sestavením SQL — žádné tiché ignorování.
 */
export const genericJsonRollbackHandler: RollbackHandler = async (action, deps) => {
  const config = ROLLBACK_TABLE_REGISTRY.get(action.entityType);
  if (!config) {
    throw new ActionLogError(
      'NO_HANDLER_REGISTERED',
      `Žádný registrovaný rollback handler pro typ '${action.entityType}'`,
    );
  }

  if (!action.beforeState) {
    throw new ActionLogError(
      'ROLLBACK_FAILED',
      'Chybí beforeState — nelze obnovit původní hodnoty',
    );
  }

  const requestedColumns = Object.keys(action.beforeState);
  if (requestedColumns.length === 0) {
    throw new ActionLogError(
      'ROLLBACK_FAILED',
      'beforeState je prázdný — nelze obnovit původní hodnoty',
    );
  }

  // CRITICAL: povolíme pouze sloupce, které jsou v allowlistu.
  // Nespouštět tiše — fail loudly, aby audit zachytil zneužití.
  const invalidColumns = requestedColumns.filter(
    (c) => !config.allowedColumns.includes(c),
  );
  if (invalidColumns.length > 0) {
    throw new ActionLogError(
      'ROLLBACK_FAILED',
      `Neplatné sloupce v beforeState: ${invalidColumns.join(', ')}`,
    );
  }

  // Build parameterized UPDATE
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const col of requestedColumns) {
    setClauses.push(`${col} = $${paramIdx}`);
    values.push(action.beforeState[col]);
    paramIdx++;
  }

  // Append the WHERE param
  values.push(action.entityId);

  // Table name, primary key a column names pocházejí z REGISTRY (server-controlled),
  // nikdy z payloadu. Hodnoty jsou bindovány jako parametry.
  const sql = `UPDATE ${config.tableName} SET ${setClauses.join(', ')} WHERE ${config.primaryKey} = $${paramIdx}`;

  await deps.db.execute(sql, values);
};
