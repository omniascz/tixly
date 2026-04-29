// =============================================================================
// Multichannel distribuce — unit testy (Feature #55)
// =============================================================================

import { describe, it, expect, vi } from 'vitest';
import {
  createAllocation,
  updateAllocation,
  listAllocations,
  pushToChannel,
  pullFromChannel,
} from '../services/channel-distribution.service.js';
import type { DbAdapter, ChannelAdapter } from '../services/channel-distribution.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EVENT_ID    = 'event-001';
const PROMOTER_ID = 'promoter-001';
const ALLOC_ID    = 'alloc-001';

function makeAllocRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ALLOC_ID,
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    channel_id: 'goout',
    allocated_qty: 100,
    sold_qty: 10,
    price_override_halire: null,
    external_event_id: null,
    status: 'draft',
    last_synced_at: null,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: executeMock,
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

function makeAdapter(overrides: Partial<ChannelAdapter> = {}): ChannelAdapter {
  return {
    pushAvailability: vi.fn().mockResolvedValue({ externalEventId: 'goout-ext-001' }),
    pullSoldQty: vi.fn().mockResolvedValue(15),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createAllocation
// ---------------------------------------------------------------------------

describe('createAllocation', () => {
  it('vloží alokaci a vrátí mapovaný objekt s availableQty', async () => {
    const db = makeDb([[makeAllocRow()]]);

    const result = await createAllocation(EVENT_ID, PROMOTER_ID, {
      channelId: 'goout',
      allocatedQty: 100,
    }, db);

    expect(result.channelId).toBe('goout');
    expect(result.availableQty).toBe(90); // 100 - 10
    expect(result.status).toBe('draft');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO channels.event_channel_allocations');
  });

  it('vyhodí VALIDATION_ERROR pro zápornou alokaci', async () => {
    const db = makeDb([]);

    await expect(
      createAllocation(EVENT_ID, PROMOTER_ID, { channelId: 'goout', allocatedQty: -1 }, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// updateAllocation
// ---------------------------------------------------------------------------

describe('updateAllocation', () => {
  it('aktualizuje allocated_qty a vrátí updated row', async () => {
    const db = makeDb([[makeAllocRow({ allocated_qty: 200, status: 'active' })]]);

    const result = await updateAllocation(ALLOC_ID, PROMOTER_ID, { allocatedQty: 200 }, db);

    expect(result.allocatedQty).toBe(200);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('promoter_id = $2'); // tenant-scoped
    expect(sql).toContain('allocated_qty');
  });

  it('vyhodí NOT_FOUND pokud alokace nepatří promotérovi', async () => {
    const db = makeDb([[]]);

    await expect(
      updateAllocation(ALLOC_ID, 'wrong-promoter', { status: 'paused' }, db),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('aktualizuje status na paused', async () => {
    const db = makeDb([[makeAllocRow({ status: 'paused' })]]);

    const result = await updateAllocation(ALLOC_ID, PROMOTER_ID, { status: 'paused' }, db);

    expect(result.status).toBe('paused');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('status');
  });
});

// ---------------------------------------------------------------------------
// listAllocations
// ---------------------------------------------------------------------------

describe('listAllocations', () => {
  it('vrátí seznam alokací pro akci', async () => {
    const db = makeDb([[
      makeAllocRow({ channel_id: 'goout' }),
      makeAllocRow({ id: 'alloc-2', channel_id: 'smsticket', allocated_qty: 50, sold_qty: 5 }),
    ]]);

    const result = await listAllocations(EVENT_ID, PROMOTER_ID, db);

    expect(result).toHaveLength(2);
    expect(result[0].channelId).toBe('goout');
    expect(result[1].channelId).toBe('smsticket');
    expect(result[1].availableQty).toBe(45); // 50 - 5
  });

  it('SQL je scoped na promoter_id', async () => {
    const db = makeDb([[]]);

    await listAllocations(EVENT_ID, PROMOTER_ID, db);

    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('promoter_id = $2');
  });
});

// ---------------------------------------------------------------------------
// pushToChannel
// ---------------------------------------------------------------------------

describe('pushToChannel', () => {
  it('volá pushAvailability s correct availableQty a uloží sync_log', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([[makeAllocRow({ status: 'active' })]], executeMock);
    const adapter = makeAdapter();

    const result = await pushToChannel(ALLOC_ID, PROMOTER_ID, adapter, db);

    expect(result.status).toBe('ok');
    expect(result.direction).toBe('push');
    expect(adapter.pushAvailability).toHaveBeenCalledWith(
      null,  // external_event_id is null in makeAllocRow
      90,    // 100 - 10 = available
      null,  // price_override_halire
      expect.objectContaining({ event_id: EVENT_ID }),
    );
    // sync_log INSERT
    expect(executeMock).toHaveBeenCalledTimes(2); // sync_log + UPDATE external_event_id
    const syncLogSql = executeMock.mock.calls[0][0] as string;
    expect(syncLogSql).toContain('channels.sync_log');
  });

  it('vyhodí NOT_FOUND pokud alokace není active', async () => {
    const db = makeDb([[]]); // prázdný výsledek
    const adapter = makeAdapter();

    await expect(
      pushToChannel(ALLOC_ID, PROMOTER_ID, adapter, db),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('loguje status=error a necrashuje pokud pushAvailability selže', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([[makeAllocRow({ status: 'active' })]], executeMock);
    const adapter = makeAdapter({
      pushAvailability: vi.fn().mockRejectedValue(new Error('GoOut API 503')),
    });

    const result = await pushToChannel(ALLOC_ID, PROMOTER_ID, adapter, db);

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('GoOut API 503');
    // sync_log stále uložen
    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('channels.sync_log');
  });
});

// ---------------------------------------------------------------------------
// pullFromChannel
// ---------------------------------------------------------------------------

describe('pullFromChannel', () => {
  it('aktualizuje sold_qty na základě hodnoty z externího kanálu', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([[makeAllocRow({ status: 'active', external_event_id: 'goout-ext-001' })]], executeMock);
    const adapter = makeAdapter({ pullSoldQty: vi.fn().mockResolvedValue(25) });

    const result = await pullFromChannel(ALLOC_ID, PROMOTER_ID, adapter, db);

    expect(result.status).toBe('ok');
    expect(result.direction).toBe('pull');
    expect(result.deltaQty).toBe(15); // 25 - 10 (původně sold_qty=10)
    // UPDATE sold_qty
    const updateSql = executeMock.mock.calls[1][0] as string;
    expect(updateSql).toContain('sold_qty = $1');
  });

  it('loguje error pokud channel hlásí oversell', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([[makeAllocRow({ status: 'active', external_event_id: 'goout-ext-001', allocated_qty: 10 })]], executeMock);
    const adapter = makeAdapter({ pullSoldQty: vi.fn().mockResolvedValue(50) }); // 50 > 10

    const result = await pullFromChannel(ALLOC_ID, PROMOTER_ID, adapter, db);

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('OVERSELL');
    // žádný UPDATE sold_qty
    expect(executeMock).toHaveBeenCalledTimes(1); // pouze sync_log
  });

  it('vyhodí VALIDATION_ERROR pokud chybí external_event_id (push nebyl proveden)', async () => {
    const db = makeDb([[makeAllocRow({ status: 'active', external_event_id: null })]]);
    const adapter = makeAdapter();

    await expect(
      pullFromChannel(ALLOC_ID, PROMOTER_ID, adapter, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});
