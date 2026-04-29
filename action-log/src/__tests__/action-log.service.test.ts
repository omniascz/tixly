import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  logAction,
  listActions,
  getAction,
  rollbackAction,
  registerRollbackHandler,
  _resetHandlerRegistryForTests,
} from '../services/action-log.service.js';
import { ActionLogError } from '../lib/action-errors.js';
import type { ServiceDeps } from '../lib/service-container.js';

const PROMOTER_ID = 'promoter-uuid-0001';
const OTHER_PROMOTER = 'promoter-uuid-0002';
const ACTION_ID = 'action-uuid-0001';
const USER_ID = 'user-uuid-0001';

function makeDeps(responses: unknown[][] = []): { deps: ServiceDeps; query: any; execute: any } {
  let i = 0;
  const query = vi.fn(async () => responses[i++] ?? []);
  const execute = vi.fn(async () => {});
  return {
    deps: { db: { query, execute } },
    query,
    execute,
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTION_ID,
    promoter_id: PROMOTER_ID,
    actor_user_id: USER_ID,
    entity_type: 'reservation',
    entity_id: 'res-1',
    action_type: 'reservation.cancel',
    before_state: { status: 'confirmed' },
    after_state: { status: 'cancelled' },
    description: null,
    rollbackable: true,
    rolled_back_at: null,
    rolled_back_by_user_id: null,
    created_at: new Date('2026-04-08T10:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  _resetHandlerRegistryForTests();
});

describe('logAction', () => {
  it('inserts a row and returns the entry', async () => {
    const { deps, query } = makeDeps([[makeRow()]]);
    const result = await logAction(
      {
        promoterId: PROMOTER_ID,
        actorUserId: USER_ID,
        entityType: 'reservation',
        entityId: 'res-1',
        actionType: 'reservation.cancel',
        beforeState: { status: 'confirmed' },
        afterState: { status: 'cancelled' },
        rollbackable: true,
      },
      deps,
    );
    expect(query).toHaveBeenCalled();
    expect(result.id).toBe(ACTION_ID);
    expect(result.rollbackable).toBe(true);
  });
});

describe('listActions', () => {
  it('filters by entityType and passes params through', async () => {
    const { deps, query } = makeDeps([
      [makeRow()],         // items
      [{ count: 1 }],      // total
    ]);
    const result = await listActions(
      PROMOTER_ID,
      { entityType: 'reservation' },
      { limit: 10 },
      deps,
    );
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    // First call — list SQL; second — count SQL
    const listParams = query.mock.calls[0][1];
    expect(listParams[0]).toBe(PROMOTER_ID);
    expect(listParams).toContain('reservation');
  });
});

describe('getAction', () => {
  it('returns action when owned by promoter', async () => {
    const { deps } = makeDeps([[makeRow()]]);
    const action = await getAction(ACTION_ID, PROMOTER_ID, deps);
    expect(action.id).toBe(ACTION_ID);
  });

  it('throws ACTION_NOT_FOUND for cross-tenant', async () => {
    const { deps } = makeDeps([[]]);
    await expect(getAction(ACTION_ID, OTHER_PROMOTER, deps)).rejects.toMatchObject({
      code: 'ACTION_NOT_FOUND',
    });
  });
});

describe('rollbackAction', () => {
  it('calls registered handler and marks rolled_back_at', async () => {
    const handler = vi.fn(async () => {});
    registerRollbackHandler('reservation', handler);

    const { deps } = makeDeps([
      [makeRow()],                                     // getAction
      [makeRow({ rolled_back_at: new Date(), rolled_back_by_user_id: USER_ID })], // UPDATE RETURNING
    ]);
    const result = await rollbackAction(ACTION_ID, PROMOTER_ID, USER_ID, deps);
    expect(handler).toHaveBeenCalledOnce();
    expect(result.rolledBackAt).not.toBeNull();
  });

  it('throws ALREADY_ROLLED_BACK if already rolled back', async () => {
    registerRollbackHandler('reservation', async () => {});
    const { deps } = makeDeps([
      [makeRow({ rolled_back_at: new Date('2026-04-01') })],
    ]);
    await expect(
      rollbackAction(ACTION_ID, PROMOTER_ID, USER_ID, deps),
    ).rejects.toMatchObject({ code: 'ALREADY_ROLLED_BACK' });
  });

  it('throws NOT_ROLLBACKABLE when rollbackable is false', async () => {
    registerRollbackHandler('reservation', async () => {});
    const { deps } = makeDeps([
      [makeRow({ rollbackable: false })],
    ]);
    await expect(
      rollbackAction(ACTION_ID, PROMOTER_ID, USER_ID, deps),
    ).rejects.toMatchObject({ code: 'NOT_ROLLBACKABLE' });
  });

  it('throws NO_HANDLER_REGISTERED when handler missing', async () => {
    const { deps } = makeDeps([
      [makeRow({ entity_type: 'unknown_entity' })],
    ]);
    await expect(
      rollbackAction(ACTION_ID, PROMOTER_ID, USER_ID, deps),
    ).rejects.toMatchObject({ code: 'NO_HANDLER_REGISTERED' });
  });

  it('wraps handler failure as ROLLBACK_FAILED', async () => {
    registerRollbackHandler('reservation', async () => {
      throw new Error('DB constraint violated');
    });
    const { deps } = makeDeps([
      [makeRow()],
    ]);
    await expect(
      rollbackAction(ACTION_ID, PROMOTER_ID, USER_ID, deps),
    ).rejects.toMatchObject({ code: 'ROLLBACK_FAILED' });
  });
});
