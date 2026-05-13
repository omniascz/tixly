import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  globalSearch,
  getOrderDetail,
  issueRefund,
  reissueTicket,
  addNote,
  getCsActionLog,
} from '../services/cs-extended.service.js';
import { isCsError, CsError } from '../lib/cs-errors.js';
import type { CsExtDeps } from '../services/cs-extended.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(queryResults: unknown[][] = []) {
  let idx = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(queryResults[idx++] ?? [])),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      return fn({
        query: vi.fn().mockImplementation(() => Promise.resolve(queryResults[idx++] ?? [])),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      });
    }),
  };
}

function makeDeps(queryResults: unknown[][] = []): CsExtDeps {
  return { db: makeDb(queryResults) };
}

// ---------------------------------------------------------------------------
// Test 1: globalSearch vrátí uživatele + objednávky
// ---------------------------------------------------------------------------

describe('globalSearch', () => {
  it('vrátí uživatele a objednávky odpovídající dotazu', async () => {
    const userRow = {
      user_id: 'user-search-1',
      email: 'novak@example.com',
      name: 'Jan Novák',
      phone: '+420777000001',
      order_count: 3,
    };
    const orderRow = {
      order_id: 'order-search-1',
      order_number: 'ORD-2026-001',
      buyer_email: 'novak@example.com',
      event_name: 'Coldplay Praha',
      total_halire: 150000,
      status: 'paid',
    };

    const deps = makeDeps([[userRow], [orderRow]]);
    const result = await globalSearch('novak', deps);

    expect(result.users).toHaveLength(1);
    expect(result.users[0]).toMatchObject({
      userId: 'user-search-1',
      email: 'novak@example.com',
      name: 'Jan Novák',
      phone: '+420777000001',
      orderCount: 3,
    });
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      orderId: 'order-search-1',
      orderNumber: 'ORD-2026-001',
      buyerEmail: 'novak@example.com',
      eventName: 'Coldplay Praha',
      totalHalire: 150000,
      status: 'paid',
    });
  });

  it('vyhodí SEARCH_QUERY_TOO_SHORT pro dotaz kratší než 3 znaky', async () => {
    const deps = makeDeps();
    try {
      await globalSearch('ab', deps);
      throw new Error('Mělo by vyhodit chybu');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('SEARCH_QUERY_TOO_SHORT');
      expect((err as CsError).statusCode).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2: getOrderDetail správně joinuje všechny tabulky
// ---------------------------------------------------------------------------

describe('getOrderDetail', () => {
  it('vrátí kompletní detail objednávky se vstupenkami, platbami a vraceními', async () => {
    const orderRow = {
      order_id: 'order-detail-1',
      order_number: 'ORD-2026-100',
      status: 'paid',
      total_halire: '200000',
      created_at: '2026-04-01T10:00:00.000Z',
      paid_at: '2026-04-01T10:05:00.000Z',
      user_id: 'user-detail-1',
      email: 'customer@example.com',
      name: 'Petra Svobodová',
      phone: null,
      event_id: 'event-detail-1',
      event_name: 'BIG BOSS Tour',
      start_date: '2026-06-15T19:00:00.000Z',
      venue_name: 'O2 Arena Praha',
    };
    const ticketRow = {
      ticket_id: 'ticket-detail-1',
      type_name: 'VIP',
      status: 'active',
      barcode_code: 'ABCD1234EFGH5678',
      holder_name: 'Petra Svobodová',
    };
    const paymentRow = {
      id: 'payment-detail-1',
      provider: 'stripe',
      status: 'succeeded',
      amount_halire: '200000',
    };
    const refundRow = {
      id: 'refund-detail-1',
      amount_halire: '50000',
      status: 'processed',
      reason: 'Zákazník požádal o částečné vrácení',
      created_at: '2026-04-03T08:00:00.000Z',
    };

    const deps = makeDeps([[orderRow], [ticketRow], [paymentRow], [refundRow]]);
    const result = await getOrderDetail('order-detail-1', deps);

    expect(result.order).toMatchObject({
      id: 'order-detail-1',
      orderNumber: 'ORD-2026-100',
      status: 'paid',
      totalHalire: 200000,
    });
    expect(result.buyer).toMatchObject({
      userId: 'user-detail-1',
      email: 'customer@example.com',
      name: 'Petra Svobodová',
      phone: null,
    });
    expect(result.event).toMatchObject({
      id: 'event-detail-1',
      name: 'BIG BOSS Tour',
      venueName: 'O2 Arena Praha',
    });
    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0].ticketId).toBe('ticket-detail-1');
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0].amountHalire).toBe(200000);
    expect(result.refunds).toHaveLength(1);
    expect(result.refunds[0].amountHalire).toBe(50000);
  });

  it('vyhodí ORDER_NOT_FOUND pro neexistující objednávku', async () => {
    const deps = makeDeps([[]]);
    try {
      await getOrderDetail('nonexistent', deps);
      throw new Error('Mělo by vyhodit chybu');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('ORDER_NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3: issueRefund deleguje refund (vytvoří záznam) a zaznamená CS akci
// ---------------------------------------------------------------------------

describe('issueRefund', () => {
  it('vytvoří záznam vrácení a zaznamená CS akci do action_log', async () => {
    const orderRow = {
      id: 'order-refund-1',
      status: 'paid',
      total_amount: '100000',
      already_refunded: '0',
      user_id: 'user-1',
      promoter_id: 'promoter-1',
    };
    const refundInsertRow = { id: 'refund-new-1' };

    let dbExecuteCount = 0;
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce([orderRow])      // SELECT order
        .mockResolvedValueOnce([refundInsertRow]), // INSERT refund_request
      execute: vi.fn().mockImplementation(async () => { dbExecuteCount++; }),
      transaction: vi.fn(),
    };

    const result = await issueRefund('order-refund-1', 50000, 'CS override vrácení peněz', 'cs-user-1', { db });

    expect(result.refundId).toBe('refund-new-1');
    // 1 × UPDATE orders status, 1 × INSERT action_log = 2 executes
    expect(dbExecuteCount).toBe(2);
  });

  it('vyhodí ORDER_NOT_FOUND když objednávka neexistuje', async () => {
    const db = makeDb([[]]);
    try {
      await issueRefund('nonexistent', 1000, 'test důvod', 'cs-1', { db });
      throw new Error('Mělo by vyhodit chybu');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('ORDER_NOT_FOUND');
    }
  });

  it('vyhodí INVALID_REFUND_AMOUNT když částka přesahuje zbývající hodnotu', async () => {
    const orderRow = {
      id: 'order-over-refund',
      status: 'paid',
      total_amount: '10000',
      already_refunded: '0',
      user_id: 'u1',
      promoter_id: 'p1',
    };
    const db = makeDb([[orderRow]]);
    try {
      await issueRefund('order-over-refund', 99999, 'Příliš velká částka', 'cs-1', { db });
      throw new Error('Mělo by vyhodit chybu');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('INVALID_REFUND_AMOUNT');
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4: reissueTicket vygeneruje nový barcode a invaliduje starý
// ---------------------------------------------------------------------------

describe('reissueTicket', () => {
  it('vytvoří náhradní vstupenku s novým barcode kódem a invaliduje původní', async () => {
    const ticketRow = {
      id: 'ticket-reissue-1',
      order_id: 'order-1',
      ticket_type_id: 'type-1',
      status: 'active',
      holder_name: 'Martin Krejčí',
      holder_email: 'martin@example.com',
      barcode_code: 'OLDBARCODE12345',
      buyer_email: 'martin@example.com',
    };
    const newTicketRow = { id: 'ticket-reissue-new-1' };

    const db = {
      query: vi.fn()
        .mockResolvedValueOnce([ticketRow])       // SELECT ticket
        .mockResolvedValueOnce([newTicketRow]),    // INSERT new ticket
      execute: vi.fn().mockResolvedValue(undefined), // UPDATE old ticket + INSERT action_log
      transaction: vi.fn(),
    };

    const result = await reissueTicket('ticket-reissue-1', 'Zákazník ztratil vstupenku', 'cs-agent-1', { db });

    expect(result.newTicketId).toBe('ticket-reissue-new-1');
    // 2 executes: UPDATE old ticket status='reissued' + INSERT action_log
    expect((db.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('vyhodí TICKET_NOT_FOUND pro neexistující vstupenku', async () => {
    const db = makeDb([[]]);
    try {
      await reissueTicket('nonexistent', 'Důvod', 'cs-1', { db });
      throw new Error('Mělo by vyhodit chybu');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('TICKET_NOT_FOUND');
    }
  });

  it('vyhodí TICKET_NOT_REISSUABLE pro zrušenou vstupenku', async () => {
    const cancelledTicket = {
      id: 'ticket-cancelled',
      order_id: 'order-1',
      ticket_type_id: 'type-1',
      status: 'cancelled',
      holder_name: null,
      holder_email: null,
      barcode_code: 'OLD',
      buyer_email: 'x@example.com',
    };
    const db = makeDb([[cancelledTicket]]);
    try {
      await reissueTicket('ticket-cancelled', 'Pokus o zrušenou', 'cs-1', { db });
      throw new Error('Mělo by vyhodit chybu');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('TICKET_NOT_REISSUABLE');
    }
  });
});

// ---------------------------------------------------------------------------
// Test 5: getCsActionLog vrací paginated záznamy a celkový počet
// ---------------------------------------------------------------------------

describe('getCsActionLog', () => {
  it('vrátí záznamy auditního logu s celkovým počtem', async () => {
    const countRow = { count: '2' };
    const logRows = [
      {
        id: 'log-1',
        cs_user_id: 'cs-user-1',
        action_type: 'refund',
        entity_type: 'order',
        entity_id: 'order-1',
        description: 'CS vrácení 50000 haléřů',
        metadata: { amountHalire: 50000 },
        created_at: '2026-04-08T10:00:00.000Z',
      },
      {
        id: 'log-2',
        cs_user_id: 'cs-user-1',
        action_type: 'note',
        entity_type: 'order',
        entity_id: 'order-1',
        description: 'Poznámka přidána: Zákazník zavolal',
        metadata: { note: 'Zákazník zavolal' },
        created_at: '2026-04-08T11:00:00.000Z',
      },
    ];

    const deps = makeDeps([[countRow], logRows]);
    const result = await getCsActionLog(
      { entityType: 'order', entityId: 'order-1' },
      { limit: 10, offset: 0 },
      deps,
    );

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      id: 'log-1',
      csUserId: 'cs-user-1',
      actionType: 'refund',
      entityType: 'order',
      entityId: 'order-1',
      description: 'CS vrácení 50000 haléřů',
    });
    expect(result.items[0].createdAt).toBeInstanceOf(Date);
  });

  it('vrátí prázdný seznam pro neexistující filtr', async () => {
    const countRow = { count: '0' };
    const deps = makeDeps([[countRow], []]);
    const result = await getCsActionLog(
      { csUserId: 'neexistující-agent' },
      {},
      deps,
    );
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Non-admin 403 — action log loguje akce + FORBIDDEN chybový kód
// ---------------------------------------------------------------------------

describe('admin-only guard a action_log', () => {
  it('CsError FORBIDDEN má statusCode 403', () => {
    const err = new CsError('FORBIDDEN');
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toContain('administrátora');
  });

  it('addNote zaznamenává akci do action_log (execute voláno 2×)', async () => {
    let execCount = 0;
    const db = {
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockImplementation(async () => { execCount++; }),
      transaction: vi.fn(),
    };

    await addNote('order', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'Zákazník volal ohledně vstupenky', 'cs-admin-1', { db });
    // 1× INSERT cs.notes, 1× INSERT cs.action_log
    expect(execCount).toBe(2);
  });

  it('issueRefund vrátí FORBIDDEN chybu s statusCode 403 při kontrole kódu', () => {
    const err = new CsError('FORBIDDEN');
    const httpErr = err.toHttpError();
    expect(httpErr).toMatchObject({
      error: 'FORBIDDEN',
      statusCode: 403,
    });
  });

  it('globalSearch vyhodí SEARCH_QUERY_TOO_SHORT pro prázdný dotaz', async () => {
    const deps = makeDeps();
    try {
      await globalSearch('', deps);
      throw new Error('Mělo by vyhodit chybu');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('SEARCH_QUERY_TOO_SHORT');
      expect((err as CsError).statusCode).toBe(400);
    }
  });

  it('getCsActionLog bez filtrů vrátí všechny záznamy (prázdná WHERE klauzule)', async () => {
    const countRow = { count: '1' };
    const logRow = {
      id: 'log-empty-filter',
      cs_user_id: 'cs-1',
      action_type: 'cancel_order',
      entity_type: 'order',
      entity_id: 'order-x',
      description: 'Objednávka zrušena CS agentem',
      metadata: {},
      created_at: '2026-04-08T12:00:00.000Z',
    };

    const deps = makeDeps([[countRow], [logRow]]);
    const result = await getCsActionLog({}, {}, deps);

    expect(result.total).toBe(1);
    expect(result.items[0].actionType).toBe('cancel_order');
  });
});
