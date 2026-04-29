import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  genericJsonRollbackHandler,
  noopRollbackHandler,
  registerRollbackTable,
  getRegisteredRollbackTable,
  _resetRollbackTableRegistryForTests,
} from '../lib/default-handlers.js';
import { ActionLogError } from '../lib/action-errors.js';
import type { ServiceDeps } from '../lib/service-container.js';
import type { ActionLogEntry } from '../types/action.js';

function makeDeps(): { deps: ServiceDeps; execute: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => []);
  return { deps: { db: { query, execute } }, execute, query };
}

function makeAction(overrides: Partial<ActionLogEntry> = {}): ActionLogEntry {
  return {
    id: 'action-1',
    promoterId: 'promoter-1',
    actorUserId: 'user-1',
    entityType: 'permanentky.client_package',
    entityId: 'pkg-1',
    actionType: 'package.update',
    beforeState: { status: 'active', remaining_entries: 10 },
    afterState: { status: 'cancelled', remaining_entries: 0 },
    description: null,
    rollbackable: true,
    rolledBackAt: null,
    rolledBackByUserId: null,
    createdAt: new Date('2026-04-08T10:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  _resetRollbackTableRegistryForTests();
});

describe('rollback table registry', () => {
  it('round-trips register + get', () => {
    registerRollbackTable('permanentky.client_package', {
      tableName: 'permanentky.client_packages',
      primaryKey: 'id',
      allowedColumns: ['status', 'remaining_entries'],
    });

    const cfg = getRegisteredRollbackTable('permanentky.client_package');
    expect(cfg).toBeDefined();
    expect(cfg?.tableName).toBe('permanentky.client_packages');
    expect(cfg?.primaryKey).toBe('id');
    expect(cfg?.allowedColumns).toEqual(['status', 'remaining_entries']);
  });

  it('returns undefined for unregistered entity', () => {
    expect(getRegisteredRollbackTable('nothing')).toBeUndefined();
  });
});

describe('noopRollbackHandler', () => {
  it('does nothing and does not touch db', async () => {
    const { deps, execute, query } = makeDeps();
    await expect(noopRollbackHandler(makeAction(), deps)).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('genericJsonRollbackHandler', () => {
  it('executes parameterized UPDATE for registered entity with valid beforeState', async () => {
    registerRollbackTable('permanentky.client_package', {
      tableName: 'permanentky.client_packages',
      primaryKey: 'id',
      allowedColumns: ['status', 'remaining_entries', 'valid_until'],
    });

    const { deps, execute } = makeDeps();
    await genericJsonRollbackHandler(makeAction(), deps);

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0]!;
    expect(sql).toBe(
      'UPDATE permanentky.client_packages SET status = $1, remaining_entries = $2 WHERE id = $3',
    );
    expect(params).toEqual(['active', 10, 'pkg-1']);
  });

  it('throws NO_HANDLER_REGISTERED for unregistered entity type', async () => {
    const { deps, execute } = makeDeps();
    await expect(
      genericJsonRollbackHandler(makeAction({ entityType: 'unknown' }), deps),
    ).rejects.toMatchObject({
      code: 'NO_HANDLER_REGISTERED',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('throws ROLLBACK_FAILED when beforeState is null', async () => {
    registerRollbackTable('permanentky.client_package', {
      tableName: 'permanentky.client_packages',
      primaryKey: 'id',
      allowedColumns: ['status'],
    });

    const { deps, execute } = makeDeps();
    await expect(
      genericJsonRollbackHandler(makeAction({ beforeState: null }), deps),
    ).rejects.toMatchObject({ code: 'ROLLBACK_FAILED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('throws ROLLBACK_FAILED on empty beforeState', async () => {
    registerRollbackTable('permanentky.client_package', {
      tableName: 'permanentky.client_packages',
      primaryKey: 'id',
      allowedColumns: ['status'],
    });

    const { deps, execute } = makeDeps();
    await expect(
      genericJsonRollbackHandler(makeAction({ beforeState: {} }), deps),
    ).rejects.toMatchObject({ code: 'ROLLBACK_FAILED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('throws with offending column names when beforeState contains non-allowlisted column', async () => {
    registerRollbackTable('permanentky.client_package', {
      tableName: 'permanentky.client_packages',
      primaryKey: 'id',
      allowedColumns: ['status'],
    });

    const { deps, execute } = makeDeps();
    await expect(
      genericJsonRollbackHandler(
        makeAction({ beforeState: { status: 'active', evil_col: 1 } }),
        deps,
      ),
    ).rejects.toMatchObject({
      code: 'ROLLBACK_FAILED',
      message: expect.stringContaining('evil_col') as unknown as string,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('SQL injection via column name is rejected (not in allowlist)', async () => {
    registerRollbackTable('permanentky.client_package', {
      tableName: 'permanentky.client_packages',
      primaryKey: 'id',
      allowedColumns: ['status'],
    });

    const { deps, execute } = makeDeps();
    await expect(
      genericJsonRollbackHandler(
        makeAction({ beforeState: { '"; DROP TABLE users; --': 'x' } }),
        deps,
      ),
    ).rejects.toMatchObject({ code: 'ROLLBACK_FAILED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('SQL injection via column value is safely bound as parameter', async () => {
    registerRollbackTable('permanentky.client_package', {
      tableName: 'permanentky.client_packages',
      primaryKey: 'id',
      allowedColumns: ['status'],
    });

    const evilValue = "'; DROP TABLE users;--";
    const { deps, execute } = makeDeps();
    await genericJsonRollbackHandler(
      makeAction({ beforeState: { status: evilValue } }),
      deps,
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0]!;
    // Evil value is NOT in the SQL string
    expect(sql).toBe('UPDATE permanentky.client_packages SET status = $1 WHERE id = $2');
    expect(sql).not.toContain('DROP TABLE');
    // It's bound as $1
    expect(params).toEqual([evilValue, 'pkg-1']);
  });
});
