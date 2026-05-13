import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import {
  createAction,
  getAction,
  executeAction,
  validateZapierRequest,
} from '../services/action.service.js';
import type { DbAdapter, HttpAdapter, ServiceDeps, ZapierAction } from '../types/zapier.types.js';
import { ZapierError } from '../types/zapier.types.js';

function makeDb(): DbAdapter {
  return { query: vi.fn(), execute: vi.fn() };
}

function makeHttp(): HttpAdapter {
  return { post: vi.fn() };
}

function makeDeps(db: DbAdapter = makeDb(), http: HttpAdapter = makeHttp()): ServiceDeps {
  return { db, http };
}

function makeAction(overrides?: Partial<ZapierAction>): ZapierAction {
  return {
    id: 'act-1',
    organizerId: 'org-1',
    actionType: 'createContact',
    config: { listId: 'list-abc' },
    isActive: true,
    createdAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('createAction', () => {
  it('inserts action and returns it', async () => {
    const db = makeDb();
    vi.mocked(db.execute).mockResolvedValue(undefined);

    const result = await createAction(
      { organizerId: 'org-1', actionType: 'createContact', config: { listId: 'L1' } },
      makeDeps(db),
    );

    expect(db.execute).toHaveBeenCalledOnce();
    expect(result.organizerId).toBe('org-1');
    expect(result.actionType).toBe('createContact');
    expect(result.config).toEqual({ listId: 'L1' });
    expect(result.isActive).toBe(true);
    expect(result.id).toBeTruthy();
  });

  it('passes correct values to the INSERT', async () => {
    const db = makeDb();
    vi.mocked(db.execute).mockResolvedValue(undefined);

    await createAction(
      { organizerId: 'org-2', actionType: 'sendSlackNotification', config: { webhookUrl: 'https://slack.com/hook' } },
      makeDeps(db),
    );

    const [sql, params] = vi.mocked(db.execute).mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO zapier_actions/i);
    expect(params).toContain('org-2');
    expect(params).toContain('sendSlackNotification');
  });
});

describe('getAction', () => {
  it('returns action when found', async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue([makeAction()]);

    const result = await getAction('act-1', makeDeps(db));
    expect(result.id).toBe('act-1');
  });

  it('throws ACTION_NOT_FOUND when action does not exist', async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue([]);

    const err = await getAction('missing', makeDeps(db)).catch((e) => e);
    expect(err).toBeInstanceOf(ZapierError);
    expect((err as ZapierError).code).toBe('ACTION_NOT_FOUND');
  });
});

describe('executeAction - createContact', () => {
  it('succeeds when config has listId', async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue([makeAction({ actionType: 'createContact', config: { listId: 'L1' } })]);

    const result = await executeAction('act-1', { email: 'a@b.com' }, makeDeps(db));
    expect(result.success).toBe(true);
  });

  it('throws INVALID_ACTION_CONFIG when listId is missing', async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue([makeAction({ actionType: 'createContact', config: {} })]);

    const err = await executeAction('act-1', {}, makeDeps(db)).catch((e) => e);
    expect(err).toBeInstanceOf(ZapierError);
    expect((err as ZapierError).code).toBe('INVALID_ACTION_CONFIG');
  });
});

describe('executeAction - sendSlackNotification', () => {
  it('succeeds when config has webhookUrl', async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue([
      makeAction({ actionType: 'sendSlackNotification', config: { webhookUrl: 'https://slack.com/hook' } }),
    ]);

    const result = await executeAction('act-1', { text: 'hello' }, makeDeps(db));
    expect(result.success).toBe(true);
  });

  it('throws INVALID_ACTION_CONFIG when webhookUrl is missing', async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue([makeAction({ actionType: 'sendSlackNotification', config: {} })]);

    await expect(executeAction('act-1', {}, makeDeps(db))).rejects.toMatchObject({
      code: 'INVALID_ACTION_CONFIG',
    });
  });
});

describe('executeAction - addToGoogleSheets', () => {
  it('succeeds when config has spreadsheetId and sheetName', async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue([
      makeAction({
        actionType: 'addToGoogleSheets',
        config: { spreadsheetId: 'sheet-123', sheetName: 'Orders' },
      }),
    ]);

    const result = await executeAction('act-1', { row: 1 }, makeDeps(db));
    expect(result.success).toBe(true);
    expect(result.message).toContain('Orders');
  });

  it('throws INVALID_ACTION_CONFIG when spreadsheetId is missing', async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue([
      makeAction({ actionType: 'addToGoogleSheets', config: { sheetName: 'Orders' } }),
    ]);

    await expect(executeAction('act-1', {}, makeDeps(db))).rejects.toMatchObject({
      code: 'INVALID_ACTION_CONFIG',
    });
  });
});

describe('validateZapierRequest', () => {
  it('does not throw for a valid signature', () => {
    const secret = 'webhook-secret';
    const payload = JSON.stringify({ event: 'order.completed', id: '42' });
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    expect(() => validateZapierRequest(payload, signature, secret)).not.toThrow();
  });

  it('throws INVALID_SIGNATURE for a tampered payload', () => {
    const secret = 'webhook-secret';
    const payload = JSON.stringify({ event: 'order.completed', id: '42' });
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const tamperedPayload = JSON.stringify({ event: 'order.completed', id: '99' });

    expect(() => validateZapierRequest(tamperedPayload, signature, secret)).toThrow(ZapierError);
  });

  it('throws INVALID_SIGNATURE for a wrong secret', () => {
    const payload = 'some payload';
    const signature = crypto.createHmac('sha256', 'right-secret').update(payload).digest('hex');

    expect(() => validateZapierRequest(payload, signature, 'wrong-secret')).toThrow(ZapierError);
  });
});
