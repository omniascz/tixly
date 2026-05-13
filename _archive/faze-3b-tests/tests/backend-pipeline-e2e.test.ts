/**
 * backend-pipeline-e2e.test.ts
 *
 * L06 — Backend smoke test: full order pipeline end-to-end.
 *
 * Pokrývá celý tok od vytvoření objednávky po odeslání e-mailu s PDF:
 *   create event → create order → GoPay webhook (PAID) → issue tickets → PDF email sent
 *
 * Veškeré IO je mockované — žádná skutečná DB, Kafka, email, GoPay ani crypto.
 * Používáme reálné service funkce ze zdrojových modulů:
 *   - handleGopayWebhook   z gopay-payments
 *   - issueTicketsForOrder z nextjs-boilerplate
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @tixly/crypto — musí být před importem ticket-issuer
// ---------------------------------------------------------------------------

vi.mock('@tixly/crypto', () => ({
  encryptSecret: vi.fn().mockResolvedValue({
    encrypted: Buffer.from('test-encrypted'),
    iv: Buffer.from('test-iv'),
  }),
}));

// ---------------------------------------------------------------------------
// Reálné service importy
// ---------------------------------------------------------------------------

import { handleGopayWebhook } from '../../gopay-payments/src/services/gopay-payment.service';
import { issueTicketsForOrder } from '../../nextjs-boilerplate/src/lib/ticket-issuer';

// ---------------------------------------------------------------------------
// Typy pro in-memory store
// ---------------------------------------------------------------------------

interface OrderRow {
  id: string;
  user_id: string;
  event_id: string;
  promoter_id: string;
  status: string;
  total_amount_halire: number;
  fulfilled_at?: string | null;
}

interface OrderItemRow {
  id: string;
  order_id: string;
  ticket_type_id: string;
  quantity: number;
  unit_price_halire: number;
}

interface GopayPaymentRow {
  id: string;
  order_id: string;
  external_payment_id: string;
  amount_halire: number;
  currency: string;
  status: string;
  payment_instrument: string | null;
  gateway_url: string | null;
  created_at: string;
  updated_at: string;
  raw_create_payload?: string | null;
  raw_last_status?: string | null;
}

interface EventRow {
  id: string;
  name: string;
  start_date: string;
  venue_id: string;
}

interface TicketTypeRow {
  id: string;
  event_id: string;
  name: string;
  price_halire: number;
  capacity: number;
  sold: number;
  zone: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  phone: string;
}

interface TicketRow {
  id: string;
  order_id: string;
  order_item_id: string;
  event_id: string;
  ticket_type_id: string;
  ticket_type_name: string;
  zone: string | null;
  owner_id: string;
  holder_name: string;
  holder_email: string;
  status: string;
  barcode_code: string;
  short_code: string;
  totp_secret_encrypted: Buffer;
  totp_secret_iv: Buffer;
  issued_at: string;
}

// ---------------------------------------------------------------------------
// In-memory DB mock
// ---------------------------------------------------------------------------

interface MockDbStore {
  'orders.orders': Map<string, OrderRow>;
  'orders.order_items': Map<string, OrderItemRow>;
  'catalog.events': Map<string, EventRow>;
  'catalog.ticket_types': Map<string, TicketTypeRow>;
  'identity.users': Map<string, UserRow>;
  'tickets.tickets': Map<string, TicketRow>;
  'payments.gopay_payments': Map<string, GopayPaymentRow>;
}

interface DbAdapter {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
  _store: MockDbStore;
}

/**
 * SQL-based dispatcher: parst SQL příkaz a routuje do správné tabulky.
 * Jednoduchý pattern-match — nepíšeme SQL parser, pouze klíčové dotazy.
 */
function createDbAdapter(store: MockDbStore): DbAdapter {
  const adapter: DbAdapter = {
    _store: store,

    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const s = sql.replace(/\s+/g, ' ').trim();

      // -----------------------------------------------------------------------
      // SELECT existing tickets for idempotency check
      // SELECT id, barcode_code, short_code FROM tickets.tickets WHERE order_id = $1
      // -----------------------------------------------------------------------
      if (/SELECT.*FROM tickets\.tickets WHERE order_id/i.test(s)) {
        const orderId = params?.[0] as string;
        const rows = [...store['tickets.tickets'].values()].filter(
          (t) => t.order_id === orderId,
        );
        if (/SELECT COUNT/i.test(s)) {
          return [{ count: String(rows.length) } as unknown as T];
        }
        return rows as unknown as T[];
      }

      // -----------------------------------------------------------------------
      // SELECT id FROM tickets.tickets WHERE order_id = $1
      // -----------------------------------------------------------------------
      if (/SELECT id FROM tickets\.tickets WHERE order_id/i.test(s)) {
        const orderId = params?.[0] as string;
        const rows = [...store['tickets.tickets'].values()]
          .filter((t) => t.order_id === orderId)
          .map((t) => ({ id: t.id }));
        return rows as unknown as T[];
      }

      // -----------------------------------------------------------------------
      // SELECT order_items JOIN ticket_types
      // -----------------------------------------------------------------------
      if (/FROM orders\.order_items oi.*JOIN catalog\.ticket_types/is.test(s)) {
        const orderId = params?.[0] as string;
        const items = [...store['orders.order_items'].values()].filter(
          (i) => i.order_id === orderId,
        );
        return items.map((item) => {
          const tt = store['catalog.ticket_types'].get(item.ticket_type_id);
          return {
            id: item.id,
            ticket_type_id: item.ticket_type_id,
            quantity: item.quantity,
            unit_price_halire: item.unit_price_halire,
            ticket_type_name: tt?.name ?? '',
            zone: tt?.zone ?? null,
          };
        }) as unknown as T[];
      }

      // -----------------------------------------------------------------------
      // SELECT * FROM payments.gopay_payments WHERE external_payment_id = $1
      // -----------------------------------------------------------------------
      if (/FROM payments\.gopay_payments WHERE external_payment_id/i.test(s)) {
        const externalId = params?.[0] as string;
        const row = [...store['payments.gopay_payments'].values()].find(
          (p) => p.external_payment_id === externalId,
        );
        return (row ? [row] : []) as unknown as T[];
      }

      // -----------------------------------------------------------------------
      // UPDATE payments.gopay_payments … RETURNING * (inside transaction)
      // -----------------------------------------------------------------------
      if (/UPDATE payments\.gopay_payments/i.test(s) && /RETURNING/i.test(s)) {
        // handled in execute — this path is only if someone does query() with RETURNING
        const id = params?.[3] as string;
        const existing = [...store['payments.gopay_payments'].values()].find((p) => p.id === id);
        if (existing) {
          existing.status = params?.[0] as string;
          existing.payment_instrument = (params?.[1] ?? existing.payment_instrument) as string | null;
          existing.raw_last_status = params?.[2] as string;
          existing.updated_at = new Date().toISOString();
        }
        return (existing ? [existing] : []) as unknown as T[];
      }

      // -----------------------------------------------------------------------
      // UPDATE orders.orders SET status = 'paid' … RETURNING id
      // -----------------------------------------------------------------------
      if (/UPDATE orders\.orders.*SET status = 'paid'/i.test(s) && /RETURNING id/i.test(s)) {
        const orderId = params?.[0] as string;
        const order = store['orders.orders'].get(orderId);
        if (order && (order.status === 'pending' || order.status === 'awaiting_payment')) {
          order.status = 'paid';
          return [{ id: orderId }] as unknown as T[];
        }
        return [] as unknown as T[];
      }

      // -----------------------------------------------------------------------
      // Fallback — empty result set
      // -----------------------------------------------------------------------
      return [] as unknown as T[];
    },

    async execute(sql: string, params?: unknown[]): Promise<void> {
      const s = sql.replace(/\s+/g, ' ').trim();

      // -----------------------------------------------------------------------
      // INSERT INTO tickets.tickets
      // -----------------------------------------------------------------------
      if (/INSERT INTO tickets\.tickets/i.test(s) && params) {
        const [
          id, order_id, order_item_id, event_id, ticket_type_id, ticket_type_name,
          zone, owner_id, holder_name, holder_email,
          barcode_code, short_code, totp_secret_encrypted, totp_secret_iv,
        ] = params as [
          string, string, string, string, string, string,
          string | null, string, string, string,
          string, string, Buffer, Buffer,
        ];
        store['tickets.tickets'].set(id, {
          id,
          order_id,
          order_item_id,
          event_id,
          ticket_type_id,
          ticket_type_name,
          zone,
          owner_id,
          holder_name,
          holder_email,
          status: 'valid',
          barcode_code,
          short_code,
          totp_secret_encrypted,
          totp_secret_iv,
          issued_at: new Date().toISOString(),
        });
        return;
      }

      // -----------------------------------------------------------------------
      // UPDATE payments.gopay_payments SET status = $1 …
      // -----------------------------------------------------------------------
      if (/UPDATE payments\.gopay_payments.*SET status/i.test(s) && params) {
        const id = params[3] as string;
        const existing = [...store['payments.gopay_payments'].values()].find((p) => p.id === id);
        if (existing) {
          existing.status = params[0] as string;
          existing.payment_instrument = (params[1] ?? existing.payment_instrument) as string | null;
          existing.raw_last_status = params[2] as string;
          existing.updated_at = new Date().toISOString();
        }
        return;
      }

      // -----------------------------------------------------------------------
      // UPDATE orders.orders SET status = 'cancelled' …
      // -----------------------------------------------------------------------
      if (/UPDATE orders\.orders.*SET status = 'cancelled'/i.test(s) && params) {
        const orderId = params[0] as string;
        const order = store['orders.orders'].get(orderId);
        if (order && (order.status === 'pending' || order.status === 'awaiting_payment')) {
          order.status = 'cancelled';
        }
        return;
      }

      // -----------------------------------------------------------------------
      // UPDATE orders.orders SET status = 'fulfilled' …
      // -----------------------------------------------------------------------
      if (/UPDATE orders\.orders.*SET status = 'fulfilled'/i.test(s) && params) {
        const orderId = params[0] as string;
        const order = store['orders.orders'].get(orderId);
        if (order && order.status === 'paid') {
          order.status = 'fulfilled';
          order.fulfilled_at = new Date().toISOString();
        }
        return;
      }

      // -----------------------------------------------------------------------
      // UPDATE orders.orders SET status = 'refunded' …
      // -----------------------------------------------------------------------
      if (/UPDATE orders\.orders.*SET status = 'refunded'/i.test(s) && params) {
        const orderId = params[0] as string;
        const order = store['orders.orders'].get(orderId);
        if (order && order.status === 'paid') {
          order.status = 'refunded';
        }
        return;
      }
    },

    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      // In-memory: předáváme stejný adapter (bez skutečného rollbacku).
      // Atomicita je garantovaná synchronním JS event-loop modelem.
      return fn(adapter);
    },
  };

  return adapter;
}

// ---------------------------------------------------------------------------
// Mock GoPay client
// ---------------------------------------------------------------------------

type GopayState = 'PAID' | 'CANCELED' | 'CREATED' | 'TIMEOUTED' | 'REFUNDED';

interface MockGopayClient {
  _state: GopayState;
  getPayment(externalId: string): Promise<{ id: string; state: string; payment_instrument?: string; amount: number; currency: string }>;
  createPayment(payload: object): Promise<{ id: string; gw_url: string; state: string }>;
}

function makeMockGopay(state: GopayState = 'PAID'): MockGopayClient {
  return {
    _state: state,
    async getPayment(externalId) {
      return {
        id: externalId,
        state: this._state,
        amount: 98000,
        currency: 'CZK',
      };
    },
    async createPayment(_payload) {
      return { id: 'GP123', gw_url: 'https://gw.gopay.cz/stub', state: 'CREATED' };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock Kafka
// ---------------------------------------------------------------------------

interface KafkaEvent {
  topic: string;
  payload: unknown;
}

interface MockKafka {
  events: KafkaEvent[];
  send(topic: string, payload: unknown): Promise<void>;
}

function makeMockKafka(): MockKafka {
  const events: KafkaEvent[] = [];
  return {
    events,
    async send(topic, payload) {
      events.push({ topic, payload });
    },
  };
}

// ---------------------------------------------------------------------------
// Mock email adapter
// ---------------------------------------------------------------------------

interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  attachments: EmailAttachment[];
}

interface MockEmail {
  outbox: EmailMessage[];
  shouldFail: boolean;
  send(msg: EmailMessage): Promise<void>;
}

function makeMockEmail(): MockEmail {
  const outbox: EmailMessage[] = [];
  return {
    outbox,
    shouldFail: false,
    async send(msg) {
      if (this.shouldFail) {
        throw new Error('SMTP connection refused');
      }
      outbox.push(msg);
    },
  };
}

// ---------------------------------------------------------------------------
// GoPay ServiceDeps builder
// ---------------------------------------------------------------------------

function makeGopayDeps(
  store: MockDbStore,
  kafka: MockKafka,
  gopay: MockGopayClient,
) {
  return {
    db: createDbAdapter(store),
    kafka,
    gopay: gopay as unknown as import('../../gopay-payments/src/lib/gopay-client').GopayHttpClient,
    config: {
      isConfigured: true,
      clientId: 'test-client-id',
      clientSecret: 'test-secret',
      goid: 123456,
      apiBaseUrl: 'https://gw.gopay.cz/api',
      notificationUrl: 'https://app.tixly.cz/api/webhooks/gopay',
      returnUrl: 'https://app.tixly.cz/payment/return',
    },
  };
}

// ---------------------------------------------------------------------------
// Pipeline orchestrator
// Replicates logic from /api/internal/order-completed without HTTP layer.
// ---------------------------------------------------------------------------

async function runOrderCompletedPipeline(
  orderId: string,
  store: MockDbStore,
  email: MockEmail,
): Promise<{ ticketsIssued: number; emailSent: boolean; fulfilled: boolean; skipped?: boolean; reason?: string }> {
  const db = createDbAdapter(store);

  // Load order
  const order = store['orders.orders'].get(orderId);
  if (!order) throw new Error('Order not found');

  // Idempotent skip
  if (order.status !== 'paid') {
    return { ticketsIssued: 0, emailSent: false, fulfilled: false, skipped: true, reason: order.status };
  }

  // Load user
  const user = store['identity.users'].get(order.user_id);
  if (!user) throw new Error('User not found');

  // Load event
  const event = store['catalog.events'].get(order.event_id);
  if (!event) throw new Error('Event not found');

  // Issue tickets (idempotent)
  const existingBefore = [...store['tickets.tickets'].values()].filter(
    (t) => t.order_id === orderId,
  );
  const alreadyIssued = existingBefore.length > 0;

  const issued = await issueTicketsForOrder(
    orderId,
    order.event_id,
    order.user_id,
    user.name,
    user.email,
    db,
  );

  // Collect ticket ids
  const ticketIds = [...store['tickets.tickets'].values()]
    .filter((t) => t.order_id === orderId)
    .map((t) => t.id);

  // Build PDF attachment stubs (one per ticket)
  const attachments: EmailAttachment[] = ticketIds.map((tid) => ({
    filename: `ticket-${tid}.pdf`,
    content: Buffer.from(`PDF_STUB_${tid}`),
    contentType: 'application/pdf',
  }));

  // Send email
  let emailSent = false;
  try {
    await email.send({
      to: user.email,
      subject: `Vaše vstupenky — ${event.name}`,
      html: `<p>Objednávka ${orderId} — ${ticketIds.length} vstupenek</p>`,
      attachments,
    });
    emailSent = true;
  } catch {
    emailSent = false;
  }

  // Mark fulfilled only if email sent
  if (emailSent) {
    const orderRecord = store['orders.orders'].get(orderId)!;
    if (orderRecord.status === 'paid') {
      orderRecord.status = 'fulfilled';
      orderRecord.fulfilled_at = new Date().toISOString();
    }
  }

  return {
    ticketsIssued: alreadyIssued ? 0 : issued.length,
    emailSent,
    fulfilled: emailSent,
  };
}

// ---------------------------------------------------------------------------
// Pre-seeded data factories
// ---------------------------------------------------------------------------

const EVENT: EventRow = {
  id: 'evt-1',
  name: 'Test Koncert',
  start_date: '2026-06-15T19:00:00Z',
  venue_id: 'ven-1',
};
const TICKET_TYPE: TicketTypeRow = {
  id: 'tt-1',
  event_id: 'evt-1',
  name: 'Standard',
  price_halire: 49000,
  capacity: 100,
  sold: 0,
  zone: null,
};
const TICKET_TYPE_VIP: TicketTypeRow = {
  id: 'tt-2',
  event_id: 'evt-1',
  name: 'VIP',
  price_halire: 99000,
  capacity: 50,
  sold: 0,
  zone: 'VIP',
};
const USER: UserRow = {
  id: 'usr-1',
  email: 'jan@example.com',
  name: 'Jan Novák',
  phone: '+420601234567',
};

function makeBaseStore(): MockDbStore {
  return {
    'orders.orders': new Map(),
    'orders.order_items': new Map(),
    'catalog.events': new Map([['evt-1', { ...EVENT }]]),
    'catalog.ticket_types': new Map([
      ['tt-1', { ...TICKET_TYPE }],
      ['tt-2', { ...TICKET_TYPE_VIP }],
    ]),
    'identity.users': new Map([['usr-1', { ...USER }]]),
    'tickets.tickets': new Map(),
    'payments.gopay_payments': new Map(),
  };
}

function seedOrder(
  store: MockDbStore,
  overrides: Partial<OrderRow> = {},
): void {
  store['orders.orders'].set('ord-1', {
    id: 'ord-1',
    user_id: 'usr-1',
    event_id: 'evt-1',
    promoter_id: 'prm-1',
    status: 'pending',
    total_amount_halire: 98000,
    ...overrides,
  });
}

function seedOrderItems(
  store: MockDbStore,
  items: Array<{ id: string; ticket_type_id: string; quantity: number; unit_price_halire: number }>,
): void {
  for (const item of items) {
    store['orders.order_items'].set(item.id, {
      id: item.id,
      order_id: 'ord-1',
      ticket_type_id: item.ticket_type_id,
      quantity: item.quantity,
      unit_price_halire: item.unit_price_halire,
    });
  }
}

function seedGopayPayment(store: MockDbStore, overrides: Partial<GopayPaymentRow> = {}): void {
  store['payments.gopay_payments'].set('gp-1', {
    id: 'gp-1',
    order_id: 'ord-1',
    external_payment_id: 'GP123',
    amount_halire: 98000,
    currency: 'CZK',
    status: 'CREATED',
    payment_instrument: null,
    gateway_url: 'https://gw.gopay.cz/stub',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    raw_create_payload: null,
    raw_last_status: null,
    ...overrides,
  });
}

// ===========================================================================
// TESTY
// ===========================================================================

describe('Backend pipeline E2E — happy path', () => {
  let store: MockDbStore;
  let kafka: MockKafka;
  let email: MockEmail;
  let gopay: MockGopayClient;

  beforeEach(() => {
    store = makeBaseStore();
    kafka = makeMockKafka();
    email = makeMockEmail();
    gopay = makeMockGopay('PAID');
    vi.clearAllMocks();
  });

  it('Full pipeline: order → GoPay payment → tickets → email', async () => {
    // 1. Seed order + items + gopay payment record
    seedOrder(store);
    seedOrderItems(store, [
      { id: 'oi-1', ticket_type_id: 'tt-1', quantity: 1, unit_price_halire: 49000 },
      { id: 'oi-2', ticket_type_id: 'tt-1', quantity: 1, unit_price_halire: 49000 },
    ]);
    seedGopayPayment(store);

    // 2. Simulate GoPay webhook (PAID)
    const webhookResult = await handleGopayWebhook(
      { id: 'GP123', orderNumber: 'ord-1', status: 'CREATED' },
      makeGopayDeps(store, kafka, gopay),
    );

    // 3. Assert order status updated to 'paid'
    expect(webhookResult.newStatus).toBe('PAID');
    expect(store['orders.orders'].get('ord-1')!.status).toBe('paid');

    // 4. Assert Kafka has gopay.payment.paid event
    const kafkaTopics = kafka.events.map((e) => e.topic);
    expect(kafkaTopics).toContain('gopay.payment.paid');

    // 5. Run order-completed pipeline
    const pipelineResult = await runOrderCompletedPipeline('ord-1', store, email);

    expect(pipelineResult.emailSent).toBe(true);
    expect(pipelineResult.fulfilled).toBe(true);

    // 6. Assert exactly 2 tickets
    const tickets = [...store['tickets.tickets'].values()].filter(
      (t) => t.order_id === 'ord-1',
    );
    expect(tickets).toHaveLength(2);

    // 7. Assert ticket fields
    for (const ticket of tickets) {
      expect(ticket.barcode_code.length).toBe(12);
      expect(ticket.short_code.length).toBe(8);
      expect(ticket.totp_secret_encrypted).toBeInstanceOf(Buffer);
      expect(ticket.status).toBe('valid');
      // Integer price check: unit_price_halire is integer
      const item = store['orders.order_items'].get(ticket.order_item_id);
      expect(item).toBeDefined();
      expect(Number.isInteger(item!.unit_price_halire)).toBe(true);
    }

    // 8. Assert email was sent once with correct recipient and subject
    expect(email.outbox).toHaveLength(1);
    expect(email.outbox[0]!.to).toBe('jan@example.com');
    expect(email.outbox[0]!.subject).toContain('Test Koncert');
    expect(email.outbox[0]!.attachments.length).toBe(2);

    // 9. Assert order fulfilled
    expect(store['orders.orders'].get('ord-1')!.status).toBe('fulfilled');

    // 10. Assert Kafka event order: gopay.payment.paid must appear
    const paidEvent = kafka.events.find((e) => e.topic === 'gopay.payment.paid');
    expect(paidEvent).toBeDefined();
    expect((paidEvent!.payload as Record<string, unknown>).orderId).toBe('ord-1');

    // 11. No orphan state — gopay payment status matches order
    expect(store['payments.gopay_payments'].get('gp-1')!.status).toBe('PAID');
  });
});

describe('Backend pipeline E2E — idempotency', () => {
  let store: MockDbStore;
  let kafka: MockKafka;
  let email: MockEmail;

  beforeEach(() => {
    store = makeBaseStore();
    kafka = makeMockKafka();
    email = makeMockEmail();
    vi.clearAllMocks();
  });

  it('Idempotent: re-running pipeline on fulfilled order does nothing', async () => {
    // Seed order already fulfilled
    seedOrder(store, { status: 'fulfilled', fulfilled_at: new Date().toISOString() });
    seedOrderItems(store, [
      { id: 'oi-1', ticket_type_id: 'tt-1', quantity: 1, unit_price_halire: 49000 },
      { id: 'oi-2', ticket_type_id: 'tt-1', quantity: 1, unit_price_halire: 49000 },
    ]);

    // Pre-existing tickets
    store['tickets.tickets'].set('tkt-existing-1', {
      id: 'tkt-existing-1',
      order_id: 'ord-1',
      order_item_id: 'oi-1',
      event_id: 'evt-1',
      ticket_type_id: 'tt-1',
      ticket_type_name: 'Standard',
      zone: null,
      owner_id: 'usr-1',
      holder_name: 'Jan Novák',
      holder_email: 'jan@example.com',
      status: 'valid',
      barcode_code: 'ABCDEF123456',
      short_code: 'ab12cd34',
      totp_secret_encrypted: Buffer.from('existing-enc'),
      totp_secret_iv: Buffer.from('existing-iv'),
      issued_at: new Date().toISOString(),
    });
    store['tickets.tickets'].set('tkt-existing-2', {
      id: 'tkt-existing-2',
      order_id: 'ord-1',
      order_item_id: 'oi-2',
      event_id: 'evt-1',
      ticket_type_id: 'tt-1',
      ticket_type_name: 'Standard',
      zone: null,
      owner_id: 'usr-1',
      holder_name: 'Jan Novák',
      holder_email: 'jan@example.com',
      status: 'valid',
      barcode_code: 'FEDCBA654321',
      short_code: 'ef56gh78',
      totp_secret_encrypted: Buffer.from('existing-enc'),
      totp_secret_iv: Buffer.from('existing-iv'),
      issued_at: new Date().toISOString(),
    });

    // Run pipeline again
    const result = await runOrderCompletedPipeline('ord-1', store, email);

    // Must skip — order not in 'paid' status
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('fulfilled');

    // No new tickets
    const tickets = [...store['tickets.tickets'].values()];
    expect(tickets).toHaveLength(2);

    // No new email
    expect(email.outbox).toHaveLength(0);
  });
});

describe('Backend pipeline E2E — payment failed path', () => {
  let store: MockDbStore;
  let kafka: MockKafka;
  let email: MockEmail;
  let gopay: MockGopayClient;

  beforeEach(() => {
    store = makeBaseStore();
    kafka = makeMockKafka();
    email = makeMockEmail();
    gopay = makeMockGopay('CANCELED');
    vi.clearAllMocks();
  });

  it('Payment failed: no tickets issued', async () => {
    seedOrder(store);
    seedOrderItems(store, [
      { id: 'oi-1', ticket_type_id: 'tt-1', quantity: 1, unit_price_halire: 49000 },
      { id: 'oi-2', ticket_type_id: 'tt-1', quantity: 1, unit_price_halire: 49000 },
    ]);
    seedGopayPayment(store);

    // Webhook with CANCELED state
    const webhookResult = await handleGopayWebhook(
      { id: 'GP123', orderNumber: 'ord-1', status: 'CREATED' },
      makeGopayDeps(store, kafka, gopay),
    );

    expect(webhookResult.newStatus).toBe('CANCELED');

    // Order status → 'cancelled'
    expect(store['orders.orders'].get('ord-1')!.status).toBe('cancelled');

    // Kafka emits failure topic
    const kafkaTopics = kafka.events.map((e) => e.topic);
    expect(kafkaTopics).toContain('gopay.payment.failed');
    expect(kafkaTopics).not.toContain('gopay.payment.paid');

    // Pipeline skips (order is cancelled, not paid)
    const pipelineResult = await runOrderCompletedPipeline('ord-1', store, email);
    expect(pipelineResult.skipped).toBe(true);

    // No tickets in DB
    expect(store['tickets.tickets'].size).toBe(0);

    // No email sent
    expect(email.outbox).toHaveLength(0);
  });
});

describe('Backend pipeline E2E — partial failure', () => {
  let store: MockDbStore;
  let kafka: MockKafka;
  let email: MockEmail;
  let gopay: MockGopayClient;

  beforeEach(() => {
    store = makeBaseStore();
    kafka = makeMockKafka();
    email = makeMockEmail();
    gopay = makeMockGopay('PAID');
    vi.clearAllMocks();
  });

  it('Partial failure: tickets issued but email fails — order stays paid (cron will pick up)', async () => {
    seedOrder(store);
    seedOrderItems(store, [
      { id: 'oi-1', ticket_type_id: 'tt-1', quantity: 1, unit_price_halire: 49000 },
      { id: 'oi-2', ticket_type_id: 'tt-1', quantity: 1, unit_price_halire: 49000 },
    ]);
    seedGopayPayment(store);

    // Webhook confirms payment
    await handleGopayWebhook(
      { id: 'GP123', orderNumber: 'ord-1', status: 'CREATED' },
      makeGopayDeps(store, kafka, gopay),
    );
    expect(store['orders.orders'].get('ord-1')!.status).toBe('paid');

    // Email adapter will throw
    email.shouldFail = true;

    // Pipeline does NOT crash — email failure is swallowed
    const pipelineResult = await runOrderCompletedPipeline('ord-1', store, email);

    // Email send was attempted but failed
    expect(pipelineResult.emailSent).toBe(false);
    expect(pipelineResult.fulfilled).toBe(false);

    // Tickets ARE in DB (issued before email failure)
    const tickets = [...store['tickets.tickets'].values()].filter(
      (t) => t.order_id === 'ord-1',
    );
    expect(tickets.length).toBeGreaterThan(0);

    // Order stays 'paid' — NOT 'fulfilled' (cron picks it up later)
    expect(store['orders.orders'].get('ord-1')!.status).toBe('paid');

    // No crash: pipeline returned normally
    expect(pipelineResult).toBeDefined();
  });
});

describe('Backend pipeline E2E — multiple ticket types', () => {
  let store: MockDbStore;
  let kafka: MockKafka;
  let email: MockEmail;
  let gopay: MockGopayClient;

  beforeEach(() => {
    store = makeBaseStore();
    kafka = makeMockKafka();
    email = makeMockEmail();
    gopay = makeMockGopay('PAID');
    vi.clearAllMocks();
  });

  it('Multiple ticket types in one order: 2× Standard + 1× VIP = 3 tickets, 3 attachments', async () => {
    // Order with 2 Standard + 1 VIP = 98000 + 99000 = 197000 halíře
    seedOrder(store, { total_amount_halire: 197000 });
    seedOrderItems(store, [
      { id: 'oi-1', ticket_type_id: 'tt-1', quantity: 2, unit_price_halire: 49000 },
      { id: 'oi-2', ticket_type_id: 'tt-2', quantity: 1, unit_price_halire: 99000 },
    ]);
    seedGopayPayment(store, { amount_halire: 197000 });

    // Webhook
    await handleGopayWebhook(
      { id: 'GP123', orderNumber: 'ord-1', status: 'CREATED' },
      makeGopayDeps(store, kafka, gopay),
    );

    // Pipeline
    const pipelineResult = await runOrderCompletedPipeline('ord-1', store, email);

    // 3 tickets total (quantity: 2 Standard + 1 VIP)
    const tickets = [...store['tickets.tickets'].values()].filter(
      (t) => t.order_id === 'ord-1',
    );
    expect(tickets).toHaveLength(3);

    // Email with 3 attachments
    expect(email.outbox).toHaveLength(1);
    expect(email.outbox[0]!.attachments.length).toBe(3);

    // All amounts are integer halíře
    for (const item of store['orders.order_items'].values()) {
      expect(Number.isInteger(item.unit_price_halire)).toBe(true);
    }
    expect(Number.isInteger(store['orders.orders'].get('ord-1')!.total_amount_halire)).toBe(true);

    // Ticket field invariants
    for (const ticket of tickets) {
      expect(ticket.barcode_code.length).toBe(12);
      expect(ticket.short_code.length).toBe(8);
      expect(ticket.totp_secret_encrypted).toBeInstanceOf(Buffer);
      expect(ticket.status).toBe('valid');
    }

    expect(pipelineResult.fulfilled).toBe(true);
    expect(store['orders.orders'].get('ord-1')!.status).toBe('fulfilled');
  });
});

describe('Backend pipeline E2E — fulfill-pending cron', () => {
  let store: MockDbStore;
  let kafka: MockKafka;
  let email: MockEmail;

  beforeEach(() => {
    store = makeBaseStore();
    kafka = makeMockKafka();
    email = makeMockEmail();
    vi.clearAllMocks();
  });

  /**
   * Simulate fulfill-pending cron logic:
   * Finds all 'paid' orders without tickets and runs the pipeline for each.
   */
  async function runFulfillPendingCron(
    s: MockDbStore,
    e: MockEmail,
  ): Promise<{ processed: string[]; skipped: string[] }> {
    const processed: string[] = [];
    const skipped: string[] = [];

    for (const [orderId, order] of s['orders.orders'].entries()) {
      if (order.status === 'paid') {
        const existingTickets = [...s['tickets.tickets'].values()].filter(
          (t) => t.order_id === orderId,
        );
        if (existingTickets.length === 0) {
          // Re-use the order_items from this specific order (not just 'ord-1')
          const result = await runOrderCompletedPipeline(orderId, s, e);
          if (result.skipped) {
            skipped.push(orderId);
          } else {
            processed.push(orderId);
          }
        } else {
          skipped.push(orderId);
        }
      } else {
        skipped.push(orderId);
      }
    }

    return { processed, skipped };
  }

  it('Fulfill-pending cron catches missed orders: only paid+unfulfilled is processed', async () => {
    // Seed 3 orders:
    //   ord-paid   → 'paid', no tickets → should be processed
    //   ord-done   → 'fulfilled', tickets exist → should be skipped
    //   ord-pend   → 'pending' → should be skipped

    store['orders.orders'].set('ord-paid', {
      id: 'ord-paid',
      user_id: 'usr-1',
      event_id: 'evt-1',
      promoter_id: 'prm-1',
      status: 'paid',
      total_amount_halire: 49000,
    });
    store['orders.orders'].set('ord-done', {
      id: 'ord-done',
      user_id: 'usr-1',
      event_id: 'evt-1',
      promoter_id: 'prm-1',
      status: 'fulfilled',
      total_amount_halire: 49000,
      fulfilled_at: new Date().toISOString(),
    });
    store['orders.orders'].set('ord-pend', {
      id: 'ord-pend',
      user_id: 'usr-1',
      event_id: 'evt-1',
      promoter_id: 'prm-1',
      status: 'pending',
      total_amount_halire: 49000,
    });

    // Order items only for ord-paid
    store['orders.order_items'].set('oi-cron-1', {
      id: 'oi-cron-1',
      order_id: 'ord-paid',
      ticket_type_id: 'tt-1',
      quantity: 1,
      unit_price_halire: 49000,
    });

    // Existing ticket for ord-done (already fulfilled)
    store['tickets.tickets'].set('tkt-done', {
      id: 'tkt-done',
      order_id: 'ord-done',
      order_item_id: 'oi-done-1',
      event_id: 'evt-1',
      ticket_type_id: 'tt-1',
      ticket_type_name: 'Standard',
      zone: null,
      owner_id: 'usr-1',
      holder_name: 'Jan Novák',
      holder_email: 'jan@example.com',
      status: 'valid',
      barcode_code: 'DONE12345678',
      short_code: 'done1234',
      totp_secret_encrypted: Buffer.from('done-enc'),
      totp_secret_iv: Buffer.from('done-iv'),
      issued_at: new Date().toISOString(),
    });

    const ticketCountBefore = store['tickets.tickets'].size; // 1 (ord-done)

    const cronResult = await runFulfillPendingCron(store, email);

    // Only ord-paid should be processed
    expect(cronResult.processed).toContain('ord-paid');
    expect(cronResult.processed).not.toContain('ord-done');
    expect(cronResult.processed).not.toContain('ord-pend');

    // ord-done and ord-pend skipped
    expect(cronResult.skipped).toContain('ord-done');
    expect(cronResult.skipped).toContain('ord-pend');

    // New tickets issued only for ord-paid
    const newTickets = [...store['tickets.tickets'].values()].filter(
      (t) => t.order_id === 'ord-paid',
    );
    expect(newTickets).toHaveLength(1);

    // Total ticket count increased by exactly 1
    expect(store['tickets.tickets'].size).toBe(ticketCountBefore + 1);

    // ord-done ticket count unchanged
    const doneTickets = [...store['tickets.tickets'].values()].filter(
      (t) => t.order_id === 'ord-done',
    );
    expect(doneTickets).toHaveLength(1);

    // Email sent only for ord-paid
    expect(email.outbox).toHaveLength(1);
    expect(email.outbox[0]!.to).toBe('jan@example.com');

    // ord-paid is now fulfilled
    expect(store['orders.orders'].get('ord-paid')!.status).toBe('fulfilled');

    // ord-done and ord-pend untouched
    expect(store['orders.orders'].get('ord-done')!.status).toBe('fulfilled');
    expect(store['orders.orders'].get('ord-pend')!.status).toBe('pending');
  });
});
