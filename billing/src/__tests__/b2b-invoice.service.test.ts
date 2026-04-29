import { describe, it, expect, vi } from 'vitest';
import {
  createInvoiceOrder,
  confirmOrder,
  markAsPaid,
  cancelOrder,
  cancelOverdueOrders,
  listInvoiceOrders,
  getInvoiceOrder,
} from '../services/b2b-invoice.service.js';
import type { DbAdapter, ProformaGenerator, EmailSender, InvoiceOrder } from '../services/b2b-invoice.service.js';

const TICKET_ITEMS = [
  { ticketTypeId: 'tt-001', qty: 10, unitPriceHellers: 50000 },
  { ticketTypeId: 'tt-002', qty: 5, unitPriceHellers: 80000 },
];

function makeOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-001',
    promoter_id: 'promoter-001',
    event_id: 'event-001',
    company_name: 'Acme s.r.o.',
    company_ico: '12345678',
    company_address: 'Václavské nám. 1, Praha',
    contact_name: 'Karel Novák',
    contact_email: 'karel@acme.cz',
    contact_phone: null,
    invoice_number: null,
    ticket_items: TICKET_ITEMS,
    total_amount_hellers: '900000', // 10*50000 + 5*80000
    vat_amount_hellers: '0',
    currency: 'CZK',
    payment_due_days: 14,
    due_date: null,
    status: 'draft',
    proforma_pdf_url: null,
    payment_reference: null,
    paid_at: null,
    cancelled_at: null,
    cancel_reason: null,
    confirmed_at: null,
    created_at: '2026-04-14T08:00:00Z',
    updated_at: '2026-04-14T08:00:00Z',
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
  };
}

function makeProformaGenerator(pdfUrl = 'https://storage.example.com/proforma-001.pdf'): ProformaGenerator {
  return { generate: vi.fn(async () => pdfUrl) };
}

function makeEmailSender(): EmailSender {
  return { sendProforma: vi.fn(async () => undefined) };
}

describe('createInvoiceOrder', () => {
  it('vytvoří B2B objednávku a spočítá celkovou částku', async () => {
    const db = makeDb([[makeOrderRow()]]);
    const result = await createInvoiceOrder({
      promoterId: 'promoter-001',
      eventId: 'event-001',
      companyName: 'Acme s.r.o.',
      companyIco: '12345678',
      companyAddress: 'Václavské nám. 1, Praha',
      contactName: 'Karel Novák',
      contactEmail: 'karel@acme.cz',
      ticketItems: TICKET_ITEMS,
    }, db);

    expect(result.status).toBe('draft');
    expect(result.totalAmountHellers).toBe(900000);
    expect(result.currency).toBe('CZK');
    expect(result.paymentDueDays).toBe(14);
  });

  it('odmítne prázdný companyName', async () => {
    const db = makeDb();
    await expect(createInvoiceOrder({
      promoterId: 'p', eventId: 'e', companyName: '   ', companyIco: '123',
      companyAddress: 'Addr', contactName: 'Jan', contactEmail: 'j@test.cz',
      ticketItems: TICKET_ITEMS,
    }, db)).rejects.toThrow('companyName is required');
  });

  it('odmítne prázdné IČO', async () => {
    const db = makeDb();
    await expect(createInvoiceOrder({
      promoterId: 'p', eventId: 'e', companyName: 'Acme', companyIco: '   ',
      companyAddress: 'Addr', contactName: 'Jan', contactEmail: 'j@test.cz',
      ticketItems: TICKET_ITEMS,
    }, db)).rejects.toThrow('companyIco is required');
  });

  it('odmítne neplatný email', async () => {
    const db = makeDb();
    await expect(createInvoiceOrder({
      promoterId: 'p', eventId: 'e', companyName: 'Acme', companyIco: '123',
      companyAddress: 'Addr', contactName: 'Jan', contactEmail: 'not-email',
      ticketItems: TICKET_ITEMS,
    }, db)).rejects.toThrow('invalid email');
  });

  it('odmítne prázdný seznam položek', async () => {
    const db = makeDb();
    await expect(createInvoiceOrder({
      promoterId: 'p', eventId: 'e', companyName: 'Acme', companyIco: '123',
      companyAddress: 'Addr', contactName: 'Jan', contactEmail: 'j@test.cz',
      ticketItems: [],
    }, db)).rejects.toThrow('at least one ticket item');
  });

  it('odmítne položku se záporným množstvím', async () => {
    const db = makeDb();
    await expect(createInvoiceOrder({
      promoterId: 'p', eventId: 'e', companyName: 'Acme', companyIco: '123',
      companyAddress: 'Addr', contactName: 'Jan', contactEmail: 'j@test.cz',
      ticketItems: [{ ticketTypeId: 'tt-001', qty: -1, unitPriceHellers: 100 }],
    }, db)).rejects.toThrow('qty must be positive');
  });

  it('odmítne paymentDueDays mimo rozsah', async () => {
    const db = makeDb();
    await expect(createInvoiceOrder({
      promoterId: 'p', eventId: 'e', companyName: 'Acme', companyIco: '123',
      companyAddress: 'Addr', contactName: 'Jan', contactEmail: 'j@test.cz',
      ticketItems: TICKET_ITEMS, paymentDueDays: 120,
    }, db)).rejects.toThrow('paymentDueDays must be between 1 and 90');
  });
});

describe('confirmOrder', () => {
  it('potvrdí objednávku, rezervuje inventory a odešle proformu', async () => {
    const draftRow = makeOrderRow({ status: 'draft' });
    const confirmedRow = makeOrderRow({
      status: 'confirmed',
      invoice_number: 'B2B-2026-123456',
      payment_reference: '1234567890',
      confirmed_at: '2026-04-14T09:00:00Z',
      due_date: '2026-04-28',
    });
    const sentRow = makeOrderRow({
      status: 'proforma_sent',
      proforma_pdf_url: 'https://storage.example.com/proforma-001.pdf',
    });
    const db = makeDb([
      [draftRow],       // fetch order
      [{ id: 'res-001' }],  // reserve tt-001
      [{ id: 'res-002' }],  // reserve tt-002
      [confirmedRow],   // mark confirmed
      [sentRow],        // mark proforma_sent
    ]);

    const proforma = makeProformaGenerator();
    const email = makeEmailSender();

    const result = await confirmOrder('order-001', 'promoter-001', proforma, email, db);
    expect(result.status).toBe('proforma_sent');
    expect(proforma.generate).toHaveBeenCalledOnce();
    expect(email.sendProforma).toHaveBeenCalledOnce();
  });

  it('vyhodí chybu pokud objednávka nenalezena', async () => {
    const db = makeDb([[]]); // empty
    const proforma = makeProformaGenerator();
    const email = makeEmailSender();
    await expect(confirmOrder('bad-id', 'promoter-001', proforma, email, db))
      .rejects.toThrow('ORDER_NOT_FOUND');
  });

  it('vyhodí chybu pro nesprávný stav', async () => {
    const db = makeDb([[makeOrderRow({ status: 'proforma_sent' })]]);
    const proforma = makeProformaGenerator();
    const email = makeEmailSender();
    await expect(confirmOrder('order-001', 'promoter-001', proforma, email, db))
      .rejects.toThrow("INVALID_STATE: order is 'proforma_sent'");
  });

  it('neselže pokud odeslání emailu selže (best-effort)', async () => {
    const draftRow = makeOrderRow({ status: 'draft' });
    const confirmedRow = makeOrderRow({ status: 'confirmed', confirmed_at: '2026-04-14T09:00:00Z' });
    const sentRow = makeOrderRow({ status: 'proforma_sent' });
    const db = makeDb([[draftRow], [{ id: 'res-001' }], [{ id: 'res-002' }], [confirmedRow], [sentRow]]);
    const proforma = makeProformaGenerator();
    const email: EmailSender = {
      sendProforma: vi.fn(async () => { throw new Error('SMTP_ERROR'); }),
    };

    // Should not throw even if email fails
    const result = await confirmOrder('order-001', 'promoter-001', proforma, email, db);
    expect(result.status).toBe('proforma_sent');
  });
});

describe('markAsPaid', () => {
  it('označí objednávku jako zaplacenou', async () => {
    const paidRow = makeOrderRow({ status: 'paid', paid_at: '2026-04-20T10:00:00Z' });
    const db = makeDb([[paidRow]]);

    const result = await markAsPaid('order-001', 'promoter-001', db);
    expect(result.status).toBe('paid');
    expect(result.paidAt).toBeTruthy();
  });

  it('vyhodí chybu pokud objednávka není ve stavu k zaplacení', async () => {
    const db = makeDb([[]]); // empty = not in right state
    await expect(markAsPaid('order-001', 'promoter-001', db))
      .rejects.toThrow('ORDER_NOT_FOUND or not in payable state');
  });
});

describe('cancelOrder', () => {
  it('zruší draft objednávku a uvolní rezervace', async () => {
    const draftRow = makeOrderRow({ status: 'draft' });
    const cancelledRow = makeOrderRow({ status: 'cancelled', cancelled_at: '2026-04-14T10:00:00Z' });
    const db = makeDb([[draftRow], [cancelledRow]]);

    const result = await cancelOrder('order-001', 'promoter-001', 'Zákazník zrušil', db);
    expect(result.status).toBe('cancelled');
    expect(db.execute).toHaveBeenCalledTimes(2); // release reservations + dunning log
  });

  it('vyhodí chybu pro zaplacenou objednávku', async () => {
    const paidRow = makeOrderRow({ status: 'paid' });
    const db = makeDb([[paidRow]]);
    await expect(cancelOrder('order-001', 'promoter-001', 'Reason', db))
      .rejects.toThrow('cannot cancel a paid order');
  });

  it('vyhodí chybu pro již zrušenou objednávku', async () => {
    const cancelledRow = makeOrderRow({ status: 'cancelled' });
    const db = makeDb([[cancelledRow]]);
    await expect(cancelOrder('order-001', 'promoter-001', 'Reason', db))
      .rejects.toThrow('already cancelled');
  });
});

describe('cancelOverdueOrders', () => {
  it('zruší objednávky po 7-denní lhůtě', async () => {
    const overdueRows = [
      makeOrderRow({ id: 'order-overdue-1', status: 'proforma_sent' }),
    ];
    const cancelledRows = [
      makeOrderRow({ id: 'order-old-1', status: 'cancelled' }),
      makeOrderRow({ id: 'order-old-2', status: 'cancelled' }),
    ];
    const db = makeDb([
      overdueRows,    // mark overdue
      cancelledRows,  // auto-cancel
    ]);

    const cancelledIds = await cancelOverdueOrders(db);
    expect(cancelledIds).toHaveLength(2);
    expect(cancelledIds).toContain('order-old-1');

    // execute called: dunning log for overdue + release reservations + dunning log for each cancelled
    // overdue: 1 (dunning log) + cancelled: 2 * 2 (release + dunning)
    expect(db.execute).toHaveBeenCalledTimes(5);
  });

  it('vrátí prázdný seznam pokud nejsou po lhůtě', async () => {
    const db = makeDb([[], []]);
    const result = await cancelOverdueOrders(db);
    expect(result).toHaveLength(0);
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe('listInvoiceOrders', () => {
  it('vrátí objednávky filtrované podle statusu', async () => {
    const db = makeDb([[
      makeOrderRow({ status: 'proforma_sent' }),
      makeOrderRow({ id: 'order-002', status: 'proforma_sent' }),
    ]]);
    const result = await listInvoiceOrders('promoter-001', null, 'proforma_sent', db);
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('proforma_sent');
  });
});

describe('getInvoiceOrder', () => {
  it('vrátí konkrétní objednávku', async () => {
    const db = makeDb([[makeOrderRow()]]);
    const result = await getInvoiceOrder('order-001', 'promoter-001', db);
    expect(result).not.toBeNull();
    expect(result!.companyName).toBe('Acme s.r.o.');
  });

  it('vrátí null pro neexistující objednávku', async () => {
    const db = makeDb([[]]); // empty
    const result = await getInvoiceOrder('bad-id', 'promoter-001', db);
    expect(result).toBeNull();
  });
});
