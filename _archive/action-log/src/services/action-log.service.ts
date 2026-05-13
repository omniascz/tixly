// =============================================================================
// SERVICE: Action log + rollback
//
// Rozšiřuje platform-admin audit pattern o možnost rollback akcí. Každá akce
// ukládá beforeState / afterState + zda je rollbackable. Skutečná restaurace
// se deleguje na entity-specifické handlery registrované přes
// `registerRollbackHandler`.
// =============================================================================

import type {
  ActionLogEntry,
  LogActionInput,
  ListActionsFilters,
  Pagination,
} from '../types/action.js';
import type { ServiceDeps } from '../lib/service-container.js';
import { ActionLogError } from '../lib/action-errors.js';
import {
  noopRollbackHandler,
  genericJsonRollbackHandler,
  type RollbackHandler,
} from '../lib/default-handlers.js';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const handlerRegistry: Map<string, RollbackHandler> = new Map();

/** Registrace per-entity handleru. Ostatní moduly volají při bootstrap. */
export function registerRollbackHandler(
  entityType: string,
  handler: RollbackHandler,
): void {
  handlerRegistry.set(entityType, handler);
}

export function getRegisteredHandlers(): ReadonlyMap<string, RollbackHandler> {
  return handlerRegistry;
}

/** Pouze pro testy — vyčistí registry. */
export function _resetHandlerRegistryForTests(): void {
  handlerRegistry.clear();
}

// Zaregistruj builtin defaulty
registerRollbackHandler('_noop', noopRollbackHandler);
registerRollbackHandler('_generic', genericJsonRollbackHandler);

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ActionRow {
  id: string;
  promoter_id: string;
  actor_user_id: string;
  entity_type: string;
  entity_id: string;
  action_type: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  description: string | null;
  rollbackable: boolean;
  rolled_back_at: Date | string | null;
  rolled_back_by_user_id: string | null;
  created_at: Date | string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toDateOrNull(value: Date | string | null): Date | null {
  if (value === null) return null;
  return toDate(value);
}

function mapRow(row: ActionRow): ActionLogEntry {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    actorUserId: row.actor_user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actionType: row.action_type,
    beforeState: row.before_state,
    afterState: row.after_state,
    description: row.description,
    rollbackable: row.rollbackable,
    rolledBackAt: toDateOrNull(row.rolled_back_at),
    rolledBackByUserId: row.rolled_back_by_user_id,
    createdAt: toDate(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// logAction
// ---------------------------------------------------------------------------

export async function logAction(
  input: LogActionInput,
  deps: ServiceDeps,
): Promise<ActionLogEntry> {
  const rows = await deps.db.query<ActionRow>(
    `INSERT INTO audit.action_log
       (promoter_id, actor_user_id, entity_type, entity_id, action_type,
        before_state, after_state, description, rollbackable)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, promoter_id, actor_user_id, entity_type, entity_id, action_type,
               before_state, after_state, description, rollbackable,
               rolled_back_at, rolled_back_by_user_id, created_at`,
    [
      input.promoterId,
      input.actorUserId,
      input.entityType,
      input.entityId,
      input.actionType,
      input.beforeState ? JSON.stringify(input.beforeState) : null,
      input.afterState ? JSON.stringify(input.afterState) : null,
      input.description ?? null,
      input.rollbackable ?? false,
    ],
  );
  const row = rows[0];
  if (!row) {
    throw new ActionLogError('ROLLBACK_FAILED', 'Akci se nepodařilo uložit.');
  }
  return mapRow(row);
}

// ---------------------------------------------------------------------------
// listActions
// ---------------------------------------------------------------------------

export async function listActions(
  promoterId: string,
  filters: ListActionsFilters,
  pagination: Pagination,
  deps: ServiceDeps,
): Promise<{ items: ActionLogEntry[]; total: number }> {
  const limit = Math.min(Math.max(pagination.limit ?? 50, 1), 500);
  const offset = Math.max(pagination.offset ?? 0, 0);

  const where: string[] = ['promoter_id = $1'];
  const params: unknown[] = [promoterId];
  let idx = 2;

  if (filters.entityType) {
    where.push(`entity_type = $${idx++}`);
    params.push(filters.entityType);
  }
  if (filters.entityId) {
    where.push(`entity_id = $${idx++}`);
    params.push(filters.entityId);
  }
  if (filters.actorUserId) {
    where.push(`actor_user_id = $${idx++}`);
    params.push(filters.actorUserId);
  }
  if (filters.from) {
    where.push(`created_at >= $${idx++}`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push(`created_at <= $${idx++}`);
    params.push(filters.to);
  }

  const whereSql = where.join(' AND ');
  const listParams = [...params, limit, offset];

  const [items, totals] = await Promise.all([
    deps.db.query<ActionRow>(
      `SELECT id, promoter_id, actor_user_id, entity_type, entity_id, action_type,
              before_state, after_state, description, rollbackable,
              rolled_back_at, rolled_back_by_user_id, created_at
       FROM audit.action_log
       WHERE ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      listParams,
    ),
    deps.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM audit.action_log WHERE ${whereSql}`,
      params,
    ),
  ]);

  return {
    items: items.map(mapRow),
    total: totals[0]?.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// getAction
// ---------------------------------------------------------------------------

export async function getAction(
  actionId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<ActionLogEntry> {
  const rows = await deps.db.query<ActionRow>(
    `SELECT id, promoter_id, actor_user_id, entity_type, entity_id, action_type,
            before_state, after_state, description, rollbackable,
            rolled_back_at, rolled_back_by_user_id, created_at
     FROM audit.action_log
     WHERE id = $1 AND promoter_id = $2
     LIMIT 1`,
    [actionId, promoterId],
  );
  const row = rows[0];
  if (!row) throw new ActionLogError('ACTION_NOT_FOUND');
  return mapRow(row);
}

// ---------------------------------------------------------------------------
// rollbackAction
// ---------------------------------------------------------------------------

export async function rollbackAction(
  actionId: string,
  promoterId: string,
  rolledBackByUserId: string,
  deps: ServiceDeps,
): Promise<ActionLogEntry> {
  const action = await getAction(actionId, promoterId, deps);

  if (action.rolledBackAt !== null) {
    throw new ActionLogError('ALREADY_ROLLED_BACK');
  }
  if (!action.rollbackable) {
    throw new ActionLogError('NOT_ROLLBACKABLE');
  }

  const handler = handlerRegistry.get(action.entityType);
  if (!handler) {
    throw new ActionLogError('NO_HANDLER_REGISTERED');
  }

  try {
    await handler(action, deps);
  } catch (err) {
    if (err instanceof ActionLogError) throw err;
    throw new ActionLogError(
      'ROLLBACK_FAILED',
      `Rollback handler selhal: ${(err as Error).message}`,
    );
  }

  const rows = await deps.db.query<ActionRow>(
    `UPDATE audit.action_log
        SET rolled_back_at = NOW(),
            rolled_back_by_user_id = $1
      WHERE id = $2 AND promoter_id = $3
      RETURNING id, promoter_id, actor_user_id, entity_type, entity_id, action_type,
                before_state, after_state, description, rollbackable,
                rolled_back_at, rolled_back_by_user_id, created_at`,
    [rolledBackByUserId, actionId, promoterId],
  );
  const row = rows[0];
  if (!row) throw new ActionLogError('ACTION_NOT_FOUND');

  // Emit event (best-effort)
  if (deps.eventBus) {
    try {
      await deps.eventBus.publish('action.rolled_back', {
        actionId: row.id,
        promoterId: row.promoter_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        rolledBackByUserId,
      });
    } catch {
      // Event bus selhání nesmí shodit rollback
    }
  }

  return mapRow(row);
}
