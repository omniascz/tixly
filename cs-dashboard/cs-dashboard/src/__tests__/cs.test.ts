import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getOrder,
  listTicketsForOrder,
  refundOrder,
  cancelOrder,
  addNote,
  transferTicket,
  getCustomer,
} from '../services/cs.service';
import { CsError, isCsError } from '../lib/cs-errors';

// ---- Fixture rows ----

const ORDER_ROW = {
  order_id: 'order-1',
  user_id: 'user-1',
  status: 'paid',
  total_amount: '5000',
  currency: 'CZK',
  payment_provider: 'stripe',
  created_at: '2026-04-01T10:00:00.000Z',
  event_id: 'event-1',
  event_title: 'SK Slavia vs AC Sparta',
  ticket_count: '2',
  refunded_amount: '0',
};

const ORDER_ROW_LOCKED = {
  id: 'order-1',
  status: 'paid',
  total_amount: '5000',
  currency: 'CZK',
  refunded_amount: '0',
};

const UPDATED_ORDER_ROW = {
  order_id: 'order-1',
  user_id: 'user-1',
  status: 'refunded',
  total_amount: '5000',
  currency: 'CZK',
  payment_provider: 'stripe',
  created_at: '2026-04-01T10:00:00.000Z',
  event_id: 'event-1',
  event_title: 'SK Slavia vs AC Sparta',
  ticket_count: '2',
  refunded_amount: '5000',
};

const TICKET_ROW = {
  ticket_id: 'ticket-1',
  order_id: 'order-1',
  holder_name: 'Jan Novák',
  holder_email: 'jan@example.com',
  status: 'active',
  transferred_at: null,
  transferred_to: null,
};

const USER_ROW = {
  user_id: 'user-1',
  email: 'jan@example.com',
  created_at: '2026-01-01T00:00:00.000Z',
};

// ---- makeDb helper ----

function makeDb(queryResults: unknown[][] = []) {
  let idx = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(queryResults[idx++] ?? [])),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      return fn({
        query: vi.fn()
          .mockResolvedValueOnce([ORDER_ROW_LOCKED])     // SELECT FOR UPDATE
          .mockResolvedValueOnce([UPDATED_ORDER_ROW]),   // SELECT updated
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      });
    }),
  };
}

// ---- makeDb with custom tx ----

function makeDbWithTx(txQueryResults: unknown[][]) {
  let txIdx = 0;
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn().mockImplementation(() => Promise.resolve(txQueryResults[txIdx++] ?? [])),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    }),
  };
}

// ========== Tests ==========

describe('getOrder', () => {
  // Test 1: returns OrderDetail correctly
  it('returns OrderDetail correctly', async () => {
    const db = makeDb([[ORDER_ROW]]);
    const result = await getOrder('order-1', { db });
    expect(result).toMatchObject({
      orderId: 'order-1',
      userId: 'user-1',
      status: 'paid',
      totalAmount: 5000,
      currency: 'CZK',
      paymentProvider: 'stripe',
      eventId: 'event-1',
      eventTitle: 'SK Slavia vs AC Sparta',
      ticketCount: 2,
      refundedAmount: 0,
    });
  });

  // Test 2: throws ORDER_NOT_FOUND
  it('throws ORDER_NOT_FOUND when order does not exist', async () => {
    const db = makeDb([[]]);
    try {
      await getOrder('nonexistent', { db });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('ORDER_NOT_FOUND');
      expect((err as CsError).statusCode).toBe(404);
    }
  });
});

describe('listTicketsForOrder', () => {
  // Test 3: returns tickets for order
  it('returns tickets for an order', async () => {
    const db = makeDb([[ORDER_ROW], [TICKET_ROW]]);
    const result = await listTicketsForOrder('order-1', { db });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ticketId: 'ticket-1',
      orderId: 'order-1',
      holderName: 'Jan Novák',
      holderEmail: 'jan@example.com',
      status: 'active',
      transferredAt: null,
      transferredTo: null,
    });
  });

  // Test 4: throws ORDER_NOT_FOUND when order row missing
  it('throws ORDER_NOT_FOUND when order does not exist', async () => {
    const db = makeDb([[]]);
    try {
      await listTicketsForOrder('nonexistent', { db });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('ORDER_NOT_FOUND');
    }
  });
});

describe('refundOrder', () => {
  // Test 5: full refund → status 'refunded'
  it('full refund changes status to refunded', async () => {
    const db = makeDb();
    const result = await refundOrder('order-1', { reason: 'Customer request', agentId: 'agent-1' }, { db });
    expect(result.status).toBe('refunded');
    expect(result.refundedAmount).toBe(5000);
  });

  // Test 6: partial refund → status 'partial_refund'
  it('partial refund changes status to partial_refund', async () => {
    const partialLockedRow = { ...ORDER_ROW_LOCKED, status: 'paid', total_amount: '5000', refunded_amount: '0' };
    const partialUpdatedRow = { ...UPDATED_ORDER_ROW, status: 'partial_refund', refunded_amount: '2000' };
    const db = makeDbWithTx([[partialLockedRow], [partialUpdatedRow]]);
    const result = await refundOrder('order-1', { amount: 2000, reason: 'Partial request', agentId: 'agent-1' }, { db });
    expect(result.status).toBe('partial_refund');
    expect(result.refundedAmount).toBe(2000);
  });

  // Test 7: throws ORDER_NOT_FOUND
  it('throws ORDER_NOT_FOUND', async () => {
    const db = makeDbWithTx([[]]);
    try {
      await refundOrder('nonexistent', { reason: 'Test reason', agentId: 'agent-1' }, { db });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('ORDER_NOT_FOUND');
    }
  });

  // Test 8: throws ORDER_ALREADY_CANCELLED
  it('throws ORDER_ALREADY_CANCELLED', async () => {
    const cancelledRow = { ...ORDER_ROW_LOCKED, status: 'cancelled' };
    const db = makeDbWithTx([[cancelledRow]]);
    try {
      await refundOrder('order-1', { reason: 'Test reason', agentId: 'agent-1' }, { db });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('ORDER_ALREADY_CANCELLED');
    }
  });

  // Test 9: throws ORDER_NOT_REFUNDABLE (status='pending')
  it('throws ORDER_NOT_REFUNDABLE when status is pending', async () => {
    const pendingRow = { ...ORDER_ROW_LOCKED, status: 'pending' };
    const db = makeDbWithTx([[pendingRow]]);
    try {
      await refundOrder('order-1', { reason: 'Test reason', agentId: 'agent-1' }, { db });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('ORDER_NOT_REFUNDABLE');
    }
  });

  // Test 10: throws INVALID_REFUND_AMOUNT (amount > remaining)
  it('throws INVALID_REFUND_AMOUNT when amount exceeds remaining', async () => {
    const db = makeDbWithTx([[ORDER_ROW_LOCKED]]);
    try {
      await refundOrder('order-1', { amount: 9999, reason: 'Test reason', agentId: 'agent-1' }, { db });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('INVALID_REFUND_AMOUNT');
    }
  });
});

describe('cancelOrder', () => {
  // Test 11: cancelOrder succeeds (no throw)
  it('succeeds without throwing', async () => {
    const db = makeDb([[{ status: 'paid' }]]);
    await expect(cancelOrder('order-1', 'Customer request to cancel', 'agent-1', { db })).resolves.toBeUndefined();
  });

  // Test 12: throws ORDER_NOT_FOUND
  it('throws ORDER_NOT_FOUND', async () => {
    const db = makeDb([[]]);
    try {
      await cancelOrder('nonexistent', 'Some reason here', 'agent-1', { db });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('ORDER_NOT_FOUND');
    }
  });

  // Test 13: throws ORDER_ALREADY_CANCELLED
  it('throws ORDER_ALREADY_CANCELLED', async () => {
    const db = makeDb([[{ status: 'cancelled' }]]);
    try {
      await cancelOrder('order-1', 'Some reason here', 'agent-1', { db });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('ORDER_ALREADY_CANCELLED');
    }
  });
});

describe('addNote', () => {
  // Test 14: addNote succeeds
  it('succeeds without throwing', async () => {
    const db = makeDb([[{ id: 'order-1' }]]);
    await expect(addNote('order-1', 'Customer called in', 'agent-1', { db })).resolves.toBeUndefined();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  // Test 15: throws ORDER_NOT_FOUND
  it('throws ORDER_NOT_FOUND', async () => {
    const db = makeDb([[]]);
    try {
      await addNote('nonexistent', 'Some note here', 'agent-1', { db });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('ORDER_NOT_FOUND');
    }
  });
});

describe('transferTicket', () => {
  // Test 16: returns TicketRow with transferred status
  it('returns TicketRow with transferred status', async () => {
    const db = makeDb([[TICKET_ROW]]);
    const result = await transferTicket('ticket-1', {
      toEmail: 'nova@example.com',
      toName: 'Nový Holder',
      agentId: 'agent-1',
    }, { db });
    expect(result).toMatchObject({
      ticketId: 'ticket-1',
      orderId: 'order-1',
      holderEmail: 'nova@example.com',
      holderName: 'Nový Holder',
      status: 'transferred',
      transferredTo: 'nova@example.com',
    });
    expect(result.transferredAt).toBeTruthy();
  });

  // Test 17: throws TICKET_NOT_FOUND
  it('throws TICKET_NOT_FOUND', async () => {
    const db = makeDb([[]]);
    try {
      await transferTicket('nonexistent', { toEmail: 'a@b.com', agentId: 'agent-1' }, { db });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('TICKET_NOT_FOUND');
    }
  });

  // Test 18: throws TICKET_ALREADY_TRANSFERRED (transferred_at != null)
  it('throws TICKET_ALREADY_TRANSFERRED when transferred_at is set', async () => {
    const alreadyTransferred = { ...TICKET_ROW, transferred_at: '2026-04-01T09:00:00.000Z' };
    const db = makeDb([[alreadyTransferred]]);
    try {
      await transferTicket('ticket-1', { toEmail: 'a@b.com', agentId: 'agent-1' }, { db });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('TICKET_ALREADY_TRANSFERRED');
    }
  });

  // Test 19: throws ORDER_ALREADY_CANCELLED (ticket status='cancelled')
  it('throws ORDER_ALREADY_CANCELLED when ticket is cancelled', async () => {
    const cancelledTicket = { ...TICKET_ROW, status: 'cancelled' };
    const db = makeDb([[cancelledTicket]]);
    try {
      await transferTicket('ticket-1', { toEmail: 'a@b.com', agentId: 'agent-1' }, { db });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('ORDER_ALREADY_CANCELLED');
    }
  });
});

describe('getCustomer', () => {
  // Test 20: returns profile with orders
  it('returns customer profile with orders', async () => {
    const orderRows = [
      { order_id: 'order-1', status: 'paid', total_amount: '5000', created_at: '2026-04-01T10:00:00.000Z', event_title: 'SK Slavia vs AC Sparta' },
    ];
    const db = makeDb([[USER_ROW], orderRows]);
    const result = await getCustomer('user-1', { db });
    expect(result).toMatchObject({
      userId: 'user-1',
      email: 'jan@example.com',
      orderCount: 1,
      totalSpent: 5000,
    });
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].orderId).toBe('order-1');
  });

  // Test 21: throws CUSTOMER_NOT_FOUND
  it('throws CUSTOMER_NOT_FOUND', async () => {
    const db = makeDb([[]]);
    try {
      await getCustomer('nonexistent', { db });
      throw new Error('Should have thrown');
    } catch (err) {
      expect(isCsError(err)).toBe(true);
      expect((err as CsError).code).toBe('CUSTOMER_NOT_FOUND');
    }
  });

  // Test 22: calculates totalSpent from paid/refunded/partial_refund orders only
  it('calculates totalSpent only from paid, refunded, and partial_refund orders', async () => {
    const orderRows = [
      { order_id: 'order-1', status: 'paid',         total_amount: '3000', created_at: '2026-04-01T10:00:00.000Z', event_title: 'Event A' },
      { order_id: 'order-2', status: 'cancelled',    total_amount: '1500', created_at: '2026-04-02T10:00:00.000Z', event_title: 'Event B' },
      { order_id: 'order-3', status: 'refunded',     total_amount: '2000', created_at: '2026-04-03T10:00:00.000Z', event_title: 'Event C' },
      { order_id: 'order-4', status: 'partial_refund', total_amount: '1000', created_at: '2026-04-04T10:00:00.000Z', event_title: 'Event D' },
      { order_id: 'order-5', status: 'pending',      total_amount: '500',  created_at: '2026-04-05T10:00:00.000Z', event_title: 'Event E' },
    ];
    const db = makeDb([[USER_ROW], orderRows]);
    const result = await getCustomer('user-1', { db });
    // paid(3000) + refunded(2000) + partial_refund(1000) = 6000; cancelled and pending excluded
    expect(result.totalSpent).toBe(6000);
    expect(result.orderCount).toBe(5);
  });
});

describe('CsError', () => {
  // Test 23: ORDER_NOT_FOUND has statusCode 404
  it('ORDER_NOT_FOUND has statusCode 404', () => {
    const err = new CsError('ORDER_NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('ORDER_NOT_FOUND');
  });

  // Test 24: ORDER_NOT_REFUNDABLE has statusCode 422
  it('ORDER_NOT_REFUNDABLE has statusCode 422', () => {
    const err = new CsError('ORDER_NOT_REFUNDABLE');
    expect(err.statusCode).toBe(422);
  });

  // Test 25: TICKET_ALREADY_TRANSFERRED has statusCode 409
  it('TICKET_ALREADY_TRANSFERRED has statusCode 409', () => {
    const err = new CsError('TICKET_ALREADY_TRANSFERRED');
    expect(err.statusCode).toBe(409);
  });

  // Test 26: toHttpError returns correct shape
  it('toHttpError returns correct shape', () => {
    const err = new CsError('CUSTOMER_NOT_FOUND');
    const httpErr = err.toHttpError();
    expect(httpErr).toMatchObject({
      error: 'CUSTOMER_NOT_FOUND',
      statusCode: 404,
      message: 'Zákazník nenalezen',
    });
  });
});

describe('refundOrder execute call count', () => {
  // Test 27: refundOrder calls execute 3 times
  it('calls execute 3 times (UPDATE orders + INSERT payment_event + INSERT cs_notes)', async () => {
    let capturedTx: { execute: ReturnType<typeof vi.fn> } | null = null;
    const db = {
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn().mockImplementation(async (fn: (tx: typeof capturedTx) => Promise<unknown>) => {
        const tx = {
          query: vi.fn()
            .mockResolvedValueOnce([ORDER_ROW_LOCKED])
            .mockResolvedValueOnce([UPDATED_ORDER_ROW]),
          execute: vi.fn().mockResolvedValue(undefined),
          transaction: vi.fn(),
        };
        capturedTx = tx;
        return fn(tx);
      }),
    };
    await refundOrder('order-1', { reason: 'Agent initiated refund', agentId: 'agent-1' }, { db });
    expect(capturedTx).not.toBeNull();
    expect(capturedTx!.execute).toHaveBeenCalledTimes(3);
  });
});

describe('cancelOrder execute call count', () => {
  // Test 28: cancelOrder calls execute 3 times
  it('calls execute 3 times (UPDATE orders + UPDATE tickets + INSERT cs_note)', async () => {
    const db = makeDb([[{ status: 'paid' }]]);
    await cancelOrder('order-1', 'Agent cancelled order for customer', 'agent-1', { db });
    expect(db.execute).toHaveBeenCalledTimes(3);
  });
});
