/**
 * order-saga-e2e.test.ts
 *
 * Feature #39 — Order saga end-to-end integration test.
 *
 * Pokrývá celý happy-path tok objednávky napříč moduly:
 *   reserve seats → price calculation → payment → OrderCompleted → ticket issued
 *
 * Všechno IO je mockované (in-memory Redis, DB, Kafka, Stripe, email).
 * Žádné skutečné síťové/DB volání.
 *
 * Cíl testu: zafixovat cross-module kontrakt sagy, ne interní chování
 * jednotlivých modulů. Pure funkce (fee calculator) se volají přímo;
 * zbytek (seat lock, payment, ticket issuance) je inline zjednodušená
 * verze, protože reálné service mají komplexní závislosti (KafkaProducerAdapter,
 * Next.js request context, Stripe SDK atd.).
 *
 * // TODO: jakmile se stabilizují exports v seat-map / stripe-payments / totp-qr /
 * // pdf-ticket modulech, nahradit inline helpery reálnými service importy.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Pure fee calculator — jediný reálný import, zbytek je mockovaný
import {
  calculateFeeForOrder,
  type OrderLineItem,
} from '../../platform-fees/src/lib/fee-calculator';

// ---------------------------------------------------------------------------
// In-memory mock infrastruktura
// ---------------------------------------------------------------------------

interface MockRedis {
  store: Map<string, { value: string; expiresAt: number | null }>;
  set(key: string, value: string, opts?: { nx?: boolean; ex?: number }): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  setex(key: string, seconds: number, value: string): Promise<'OK'>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

function makeMockRedis(): MockRedis {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  const isExpired = (entry: { expiresAt: number | null }) =>
    entry.expiresAt !== null && entry.expiresAt < Date.now();

  return {
    store,
    async set(key, value, opts) {
      const existing = store.get(key);
      if (existing && !isExpired(existing) && opts?.nx) return null;
      const expiresAt = opts?.ex ? Date.now() + opts.ex * 1000 : null;
      store.set(key, { value, expiresAt });
      return 'OK';
    },
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (isExpired(entry)) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
    async setex(key, seconds, value) {
      store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
      return 'OK';
    },
    async incr(key) {
      const entry = store.get(key);
      const current = entry ? parseInt(entry.value, 10) : 0;
      const next = current + 1;
      store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
      return next;
    },
    async expire(key, seconds) {
      const entry = store.get(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    },
  };
}

interface SeatRow {
  id: string;
  eventId: string;
  label: string;
  price: number; // haléře
  status: 'available' | 'locked' | 'sold';
}
interface OrderRow {
  id: string;
  userId: string;
  eventId: string;
  amount: number;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
}
interface TicketRow {
  id: string;
  orderId: string;
  seatId: string;
  userId: string;
  totpSecret: string;
  barcodeCode: string;
}

interface MockDb {
  events: Map<string, { id: string; promoterId: string; startsAt: Date }>;
  seats: Map<string, SeatRow>;
  feeSchedules: Map<string, { id: string; promoterId: string; percentageFee: number; fixedFee: number; minFee: number; maxFee: number | null }>;
  users: Map<string, { id: string; email: string }>;
  orders: Map<string, OrderRow>;
  tickets: Map<string, TicketRow>;
  transaction<T>(fn: (tx: MockDb) => Promise<T>): Promise<T>;
}

function makeMockDb(): MockDb {
  const db: MockDb = {
    events: new Map([
      ['event-1', { id: 'event-1', promoterId: 'promoter-1', startsAt: new Date('2026-06-01T19:00:00Z') }],
    ]),
    seats: new Map([
      ['seat-A1', { id: 'seat-A1', eventId: 'event-1', label: 'A1', price: 50_000, status: 'available' }],
      ['seat-A2', { id: 'seat-A2', eventId: 'event-1', label: 'A2', price: 50_000, status: 'available' }],
    ]),
    feeSchedules: new Map([
      ['fs-1', { id: 'fs-1', promoterId: 'promoter-1', percentageFee: 500, fixedFee: 2000, minFee: 0, maxFee: null }],
    ]),
    users: new Map([
      ['user-1', { id: 'user-1', email: 'buyer@example.com' }],
    ]),
    orders: new Map(),
    tickets: new Map(),
    async transaction(fn) {
      // Pro jednoduchost: předáváme samotnou instanci, bez snapshotu.
      // Rollback v testu děláme explicitně v catch větvi sagy.
      return fn(db);
    },
  };
  return db;
}

interface KafkaEvent {
  topic: string;
  payload: Record<string, unknown>;
}

interface MockKafka {
  events: KafkaEvent[];
  send(topic: string, payload: Record<string, unknown>): Promise<void>;
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

interface MockStripe {
  mode: 'success' | 'failure';
  createPaymentIntent(amount: number): Promise<{ id: string; status: 'succeeded' | 'failed'; amount: number }>;
}

function makeMockStripe(mode: 'success' | 'failure' = 'success'): MockStripe {
  let counter = 0;
  return {
    mode,
    async createPaymentIntent(amount) {
      counter++;
      return {
        id: `pi_mock_${counter}`,
        status: this.mode === 'success' ? 'succeeded' : 'failed',
        amount,
      };
    },
  };
}

interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}
interface MockEmail {
  outbox: EmailMessage[];
  send(msg: EmailMessage): Promise<void>;
}

function makeMockEmail(): MockEmail {
  const outbox: EmailMessage[] = [];
  return {
    outbox,
    async send(msg) {
      outbox.push(msg);
    },
  };
}

// ---------------------------------------------------------------------------
// Saga krokové helpery (inline zjednodušená verze reálných services)
// ---------------------------------------------------------------------------

const SEAT_LOCK_TTL_SECONDS = 7 * 60;

function seatLockKey(eventId: string, seatId: string): string {
  return `seatlock:${eventId}:${seatId}`;
}

async function acquireSeatLocks(
  redis: MockRedis,
  eventId: string,
  seatIds: string[],
  lockToken: string,
): Promise<boolean> {
  const acquired: string[] = [];
  for (const seatId of seatIds) {
    const result = await redis.set(seatLockKey(eventId, seatId), lockToken, {
      nx: true,
      ex: SEAT_LOCK_TTL_SECONDS,
    });
    if (result !== 'OK') {
      // Rollback již získaných zámků
      for (const id of acquired) {
        await redis.del(seatLockKey(eventId, id));
      }
      return false;
    }
    acquired.push(seatId);
  }
  return true;
}

async function releaseSeatLocks(
  redis: MockRedis,
  eventId: string,
  seatIds: string[],
): Promise<void> {
  for (const seatId of seatIds) {
    await redis.del(seatLockKey(eventId, seatId));
  }
}

/**
 * Zjednodušený generátor TOTP secretu (base32, 32 znaků).
 * // TODO: nahradit importem z totp-qr/src/services/ticket-qr.service
 */
function generateTotpSecret(): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += charset[Math.floor(Math.random() * charset.length)];
  }
  return out;
}

function generateBarcodeCode(): string {
  return 'TKT-' + Math.random().toString(36).slice(2, 14).toUpperCase();
}

// ---------------------------------------------------------------------------
// Orchestrátor sagy (happy path + rollback větve)
// ---------------------------------------------------------------------------

interface SagaDeps {
  redis: MockRedis;
  db: MockDb;
  kafka: MockKafka;
  stripe: MockStripe;
  email: MockEmail;
}

interface SagaInput {
  userId: string;
  eventId: string;
  seatIds: string[];
}

interface SagaResult {
  status: 'completed' | 'aborted' | 'rolled-back';
  orderId?: string;
  ticketIds?: string[];
  error?: string;
}

async function runOrderSaga(deps: SagaDeps, input: SagaInput): Promise<SagaResult> {
  const { redis, db, kafka, stripe, email } = deps;
  const { userId, eventId, seatIds } = input;
  const lockToken = `lock-${userId}-${Date.now()}`;

  // 1) Seat lock
  const locked = await acquireSeatLocks(redis, eventId, seatIds, lockToken);
  if (!locked) {
    return { status: 'aborted', error: 'SEAT_ALREADY_LOCKED' };
  }

  try {
    // 2) Price calculation
    const seats = seatIds.map((id) => {
      const row = db.seats.get(id);
      if (!row) throw new Error(`seat not found: ${id}`);
      return row;
    });
    const schedule = db.feeSchedules.get('fs-1');
    if (!schedule) {
      throw new Error('NO_ACTIVE_FEE_SCHEDULE');
    }
    const lineItems: OrderLineItem[] = seats.map((s) => ({ price: s.price, quantity: 1 }));
    const feeResult = calculateFeeForOrder(lineItems, schedule);
    const totalAmount = feeResult.totalGrossRevenue;

    // 3) Payment
    const paymentIntent = await stripe.createPaymentIntent(totalAmount);
    if (paymentIntent.status !== 'succeeded') {
      await kafka.send('payment.failed', {
        paymentIntentId: paymentIntent.id,
        userId,
        eventId,
        amount: totalAmount,
      });
      await releaseSeatLocks(redis, eventId, seatIds);
      return { status: 'rolled-back', error: 'PAYMENT_DECLINED' };
    }
    await kafka.send('payment.succeeded', {
      paymentIntentId: paymentIntent.id,
      userId,
      amount: totalAmount,
    });

    // Transakce: vytvoření order + tickets
    const result = await db.transaction(async (tx) => {
      const orderId = `order-${tx.orders.size + 1}`;
      const order: OrderRow = {
        id: orderId,
        userId,
        eventId,
        amount: totalAmount,
        status: 'paid',
      };
      tx.orders.set(orderId, order);

      // 5) Ticket issuance
      const ticketIds: string[] = [];
      for (const seat of seats) {
        const ticketId = `ticket-${tx.tickets.size + 1}`;
        tx.tickets.set(ticketId, {
          id: ticketId,
          orderId,
          seatId: seat.id,
          userId,
          totpSecret: generateTotpSecret(),
          barcodeCode: generateBarcodeCode(),
        });
        seat.status = 'sold';
        ticketIds.push(ticketId);
      }

      return { orderId, ticketIds };
    });

    // 4) OrderCompleted event
    await kafka.send('order.completed', {
      orderId: result.orderId,
      userId,
      eventId,
      amount: totalAmount,
    });

    // Emit ticket.issued per ticket
    for (const ticketId of result.ticketIds) {
      await kafka.send('ticket.issued', {
        ticketId,
        orderId: result.orderId,
        userId,
      });
    }

    // 6) Confirmation email
    const user = db.users.get(userId);
    if (user) {
      await email.send({
        to: user.email,
        subject: 'Vaše vstupenky jsou připravené',
        body: `Objednávka ${result.orderId} byla zaplacena. Počet vstupenek: ${result.ticketIds.length}.`,
      });
    }

    // Release seat locks po úspěšném vydání (už jsou sold)
    await releaseSeatLocks(redis, eventId, seatIds);

    return { status: 'completed', orderId: result.orderId, ticketIds: result.ticketIds };
  } catch (err) {
    // Rollback: uvolnit seat locks, žádné tickets/order se nezapisují (pokud jsme padli před transakcí)
    await releaseSeatLocks(redis, eventId, seatIds);
    return {
      status: 'rolled-back',
      error: err instanceof Error ? err.message : 'UNKNOWN',
    };
  }
}

// ===========================================================================
// TESTY
// ===========================================================================

describe('Order saga — end-to-end happy path', () => {
  let deps: SagaDeps;

  beforeEach(() => {
    deps = {
      redis: makeMockRedis(),
      db: makeMockDb(),
      kafka: makeMockKafka(),
      stripe: makeMockStripe('success'),
      email: makeMockEmail(),
    };
  });

  it('completes full flow from seat lock to ticket issuance', async () => {
    const result = await runOrderSaga(deps, {
      userId: 'user-1',
      eventId: 'event-1',
      seatIds: ['seat-A1', 'seat-A2'],
    });

    // Saga úspěšně dokončena
    expect(result.status).toBe('completed');
    expect(result.orderId).toBeDefined();
    expect(result.ticketIds).toHaveLength(2);

    // 1) Seat lock byl acquire-nutý — po vydání tiketů jsou locks uvolněné,
    // ale seats mají status 'sold'
    expect(deps.db.seats.get('seat-A1')!.status).toBe('sold');
    expect(deps.db.seats.get('seat-A2')!.status).toBe('sold');

    // 2) Order v DB s correct amount
    const order = deps.db.orders.get(result.orderId!);
    expect(order).toBeDefined();
    expect(order!.status).toBe('paid');
    expect(order!.amount).toBe(100_000); // 2 × 500 Kč
    expect(Number.isInteger(order!.amount)).toBe(true); // integer halíře

    // 3) 2 tickets inserted
    expect(deps.db.tickets.size).toBe(2);
    for (const ticketId of result.ticketIds!) {
      const ticket = deps.db.tickets.get(ticketId);
      expect(ticket).toBeDefined();
      // TOTP secret base32, 32 znaků
      expect(ticket!.totpSecret).toMatch(/^[A-Z2-7]{32}$/);
      expect(ticket!.barcodeCode).toMatch(/^TKT-/);
    }

    // 4) Kafka events — správné pořadí podle kroků sagy
    const topics = deps.kafka.events.map((e) => e.topic);
    expect(topics).toEqual([
      'payment.succeeded',
      'order.completed',
      'ticket.issued',
      'ticket.issued',
    ]);

    // 5) order.completed payload
    const orderCompletedEvent = deps.kafka.events.find((e) => e.topic === 'order.completed');
    expect(orderCompletedEvent).toBeDefined();
    expect(orderCompletedEvent!.payload).toMatchObject({
      orderId: result.orderId,
      userId: 'user-1',
      eventId: 'event-1',
      amount: 100_000,
    });

    // 6) 2× ticket.issued event
    const ticketEvents = deps.kafka.events.filter((e) => e.topic === 'ticket.issued');
    expect(ticketEvents).toHaveLength(2);
    for (const evt of ticketEvents) {
      expect(evt.payload.orderId).toBe(result.orderId);
      expect(evt.payload.userId).toBe('user-1');
    }

    // 7) Confirmation email
    expect(deps.email.outbox).toHaveLength(1);
    expect(deps.email.outbox[0]!.to).toBe('buyer@example.com');
    expect(deps.email.outbox[0]!.body).toContain(result.orderId!);
  });

  it('fee calculation — totalPlatformFee > 0 a lineItems.length === 2', async () => {
    const schedule = deps.db.feeSchedules.get('fs-1')!;
    const feeResult = calculateFeeForOrder(
      [
        { price: 50_000, quantity: 1 },
        { price: 50_000, quantity: 1 },
      ],
      schedule,
    );
    expect(feeResult.lineItems).toHaveLength(2);
    expect(feeResult.totalPlatformFee).toBeGreaterThan(0);
    expect(feeResult.totalGrossRevenue).toBe(100_000);
    expect(Number.isInteger(feeResult.totalPlatformFee)).toBe(true);
    expect(Number.isInteger(feeResult.totalGrossRevenue)).toBe(true);
  });
});

describe('Order saga — failure paths', () => {
  let deps: SagaDeps;

  beforeEach(() => {
    deps = {
      redis: makeMockRedis(),
      db: makeMockDb(),
      kafka: makeMockKafka(),
      stripe: makeMockStripe('success'),
      email: makeMockEmail(),
    };
  });

  it('seat already locked → saga aborts, no payment/tickets/emails', async () => {
    // Pre-existující lock na seat-A1 (jiný držitel)
    await deps.redis.set(seatLockKey('event-1', 'seat-A1'), 'other-user-token', {
      nx: true,
      ex: SEAT_LOCK_TTL_SECONDS,
    });

    const result = await runOrderSaga(deps, {
      userId: 'user-1',
      eventId: 'event-1',
      seatIds: ['seat-A1', 'seat-A2'],
    });

    expect(result.status).toBe('aborted');
    expect(result.error).toBe('SEAT_ALREADY_LOCKED');

    // Žádná platba, žádné tickets, žádné emails
    expect(deps.db.orders.size).toBe(0);
    expect(deps.db.tickets.size).toBe(0);
    expect(deps.email.outbox).toHaveLength(0);
    expect(deps.kafka.events).toHaveLength(0);

    // Seaty zůstaly available (nebyly sold)
    expect(deps.db.seats.get('seat-A1')!.status).toBe('available');
    expect(deps.db.seats.get('seat-A2')!.status).toBe('available');

    // Existující lock stále drží původní (cizí) token — ne náš
    const existingLock = await deps.redis.get(seatLockKey('event-1', 'seat-A1'));
    expect(existingLock).toBe('other-user-token');
  });

  it('payment declined → saga rolls back (locks released, no tickets, payment.failed emitted)', async () => {
    deps.stripe = makeMockStripe('failure');

    const result = await runOrderSaga(deps, {
      userId: 'user-1',
      eventId: 'event-1',
      seatIds: ['seat-A1', 'seat-A2'],
    });

    expect(result.status).toBe('rolled-back');
    expect(result.error).toBe('PAYMENT_DECLINED');

    // Žádné tickets, žádný paid order, žádný email
    expect(deps.db.tickets.size).toBe(0);
    expect(deps.db.orders.size).toBe(0);
    expect(deps.email.outbox).toHaveLength(0);

    // Seaty zůstaly available
    expect(deps.db.seats.get('seat-A1')!.status).toBe('available');
    expect(deps.db.seats.get('seat-A2')!.status).toBe('available');

    // Seat locks byly uvolněné
    expect(await deps.redis.get(seatLockKey('event-1', 'seat-A1'))).toBeNull();
    expect(await deps.redis.get(seatLockKey('event-1', 'seat-A2'))).toBeNull();

    // Kafka: payment.failed ANO, order.completed NE
    const topics = deps.kafka.events.map((e) => e.topic);
    expect(topics).toContain('payment.failed');
    expect(topics).not.toContain('order.completed');
    expect(topics).not.toContain('ticket.issued');
    expect(topics).not.toContain('payment.succeeded');
  });

  it('fee calculation throws (missing fee schedule) → saga rolls back before payment', async () => {
    // Odstranit fee schedule → calculateFeeForOrder selže (NO_ACTIVE_FEE_SCHEDULE)
    deps.db.feeSchedules.clear();

    const result = await runOrderSaga(deps, {
      userId: 'user-1',
      eventId: 'event-1',
      seatIds: ['seat-A1', 'seat-A2'],
    });

    expect(result.status).toBe('rolled-back');
    expect(result.error).toBe('NO_ACTIVE_FEE_SCHEDULE');

    // Žádná platba, žádné tickets, žádný order
    expect(deps.db.orders.size).toBe(0);
    expect(deps.db.tickets.size).toBe(0);
    expect(deps.email.outbox).toHaveLength(0);

    // Seat locks uvolněné
    expect(await deps.redis.get(seatLockKey('event-1', 'seat-A1'))).toBeNull();
    expect(await deps.redis.get(seatLockKey('event-1', 'seat-A2'))).toBeNull();

    // Žádný platební event
    const topics = deps.kafka.events.map((e) => e.topic);
    expect(topics).not.toContain('payment.succeeded');
    expect(topics).not.toContain('payment.failed');
    expect(topics).not.toContain('order.completed');
  });
});
