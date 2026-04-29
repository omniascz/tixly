// =============================================================================
// GoPay Payment Service
//
// SCHEMA (viz migrations/070_gopay_payments.sql):
//
//   CREATE TABLE payments.gopay_payments (
//     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     order_id TEXT NOT NULL,
//     external_payment_id TEXT UNIQUE,
//     amount_halire INTEGER NOT NULL,
//     currency TEXT NOT NULL DEFAULT 'CZK',
//     status TEXT NOT NULL,
//     payment_instrument TEXT,
//     gateway_url TEXT,
//     buyer_email TEXT,
//     buyer_first_name TEXT,
//     buyer_last_name TEXT,
//     raw_create_payload JSONB,
//     raw_last_status JSONB,
//     created_at TIMESTAMPTZ DEFAULT NOW(),
//     updated_at TIMESTAMPTZ DEFAULT NOW()
//   );
//
// Všechny částky jsou INTEGER haléře. Kafka topics:
//   gopay.payment.created | gopay.payment.paid | gopay.payment.refunded | gopay.payment.failed
// =============================================================================

import { GopayError } from '../lib/gopay-errors.js';
import type { ServiceDeps } from '../lib/service-container.js';
import type {
  GopayCreatePaymentInput,
  GopayPayment,
  GopayPaymentInstrument,
  GopayPaymentStatus,
  GopayWebhookPayload,
  GopayCurrency,
} from '../types/gopay.js';

// ---------------------------------------------------------------------------
// Interní DB row typ
// ---------------------------------------------------------------------------
interface GopayPaymentRow {
  id: string;
  order_id: string;
  external_payment_id: string | null;
  amount_halire: number;
  currency: string;
  status: string;
  payment_instrument: string | null;
  gateway_url: string | null;
  created_at: string;
  updated_at: string;
}

function rowToPayment(row: GopayPaymentRow): GopayPayment {
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status as GopayPaymentStatus,
    amountHalire: row.amount_halire,
    currency: row.currency as GopayCurrency,
    gatewayUrl: row.gateway_url ?? '',
    paymentInstrument: (row.payment_instrument ?? null) as GopayPaymentInstrument | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeStatus(state: string): GopayPaymentStatus {
  const allowed: GopayPaymentStatus[] = [
    'CREATED',
    'PAYMENT_METHOD_CHOSEN',
    'PAID',
    'AUTHORIZED',
    'CANCELED',
    'TIMEOUTED',
    'REFUNDED',
    'PARTIALLY_REFUNDED',
  ];
  return (allowed.includes(state as GopayPaymentStatus) ? state : 'CREATED') as GopayPaymentStatus;
}

// ---------------------------------------------------------------------------
// createGopayPayment
// ---------------------------------------------------------------------------
export async function createGopayPayment(
  input: GopayCreatePaymentInput,
  deps: ServiceDeps,
): Promise<GopayPayment> {
  if (!Number.isInteger(input.amountHalire) || input.amountHalire <= 0) {
    throw new GopayError('GOPAY_INVALID_AMOUNT');
  }
  for (const it of input.items) {
    if (!Number.isInteger(it.amountHalire) || it.amountHalire <= 0 || it.count <= 0) {
      throw new GopayError('GOPAY_INVALID_AMOUNT');
    }
  }

  const { db, kafka, gopay, config } = deps;

  const gopayPayload = {
    payer: {
      default_payment_instrument: 'PAYMENT_CARD',
      allowed_payment_instruments:
        input.allowedPaymentInstruments ?? ['PAYMENT_CARD', 'BANK_ACCOUNT', 'GPAY'],
      contact: {
        email: input.buyerEmail,
        first_name: input.buyerFirstName ?? '',
        last_name: input.buyerLastName ?? '',
        phone_number: input.buyerPhone ?? '',
      },
    },
    amount: input.amountHalire,
    currency: input.currency,
    order_number: input.orderId,
    order_description: input.description,
    items: input.items.map((i) => ({
      name: i.name,
      amount: i.amountHalire,
      count: i.count,
    })),
    callback: {
      return_url: input.returnUrl ?? config.returnUrl,
      notification_url: config.notificationUrl,
    },
    target: {
      type: 'ACCOUNT',
      goid: config.goid,
    },
    lang: 'CS',
  };

  const gopayResult = await gopay.createPayment(gopayPayload);

  const payment = await db.transaction(async (tx) => {
    const [inserted] = await tx.query<GopayPaymentRow>(
      `INSERT INTO payments.gopay_payments
         (order_id, external_payment_id, amount_halire, currency, status,
          payment_instrument, gateway_url, buyer_email, buyer_first_name, buyer_last_name,
          raw_create_payload, raw_last_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        input.orderId,
        gopayResult.id,
        input.amountHalire,
        input.currency,
        normalizeStatus(gopayResult.state),
        gopayResult.payment_instrument ?? null,
        gopayResult.gw_url,
        input.buyerEmail,
        input.buyerFirstName ?? null,
        input.buyerLastName ?? null,
        JSON.stringify(gopayPayload),
        JSON.stringify(gopayResult),
      ],
    );
    if (!inserted) {
      throw new GopayError('GOPAY_API_ERROR', 'Nepodařilo se uložit platbu do DB.');
    }
    return rowToPayment(inserted);
  });

  await kafka.send('gopay.payment.created', {
    id: payment.id,
    orderId: payment.orderId,
    externalPaymentId: gopayResult.id,
    amountHalire: payment.amountHalire,
    currency: payment.currency,
    status: payment.status,
  });

  return payment;
}

// ---------------------------------------------------------------------------
// getGopayPayment — načte z DB a refreshne stav via GoPay API
// ---------------------------------------------------------------------------
export async function getGopayPayment(
  paymentId: string,
  deps: ServiceDeps,
): Promise<GopayPayment> {
  const { db, gopay } = deps;

  const [row] = await db.query<GopayPaymentRow>(
    `SELECT * FROM payments.gopay_payments WHERE id = $1 OR external_payment_id = $1 LIMIT 1`,
    [paymentId],
  );

  if (!row) {
    throw new GopayError('GOPAY_PAYMENT_NOT_FOUND');
  }

  if (!row.external_payment_id) {
    return rowToPayment(row);
  }

  const fresh = await gopay.getPayment(row.external_payment_id);
  const newStatus = normalizeStatus(fresh.state);

  if (newStatus !== row.status || (fresh.payment_instrument ?? null) !== row.payment_instrument) {
    const [updated] = await db.query<GopayPaymentRow>(
      `UPDATE payments.gopay_payments
         SET status = $1,
             payment_instrument = COALESCE($2, payment_instrument),
             raw_last_status = $3,
             updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [newStatus, fresh.payment_instrument ?? null, JSON.stringify(fresh), row.id],
    );
    return rowToPayment(updated ?? row);
  }

  return rowToPayment(row);
}

// ---------------------------------------------------------------------------
// handleGopayWebhook
//
// Anti-spoofing: NEVĚŘÍME payloadu webhooku. Vždy re-fetch přes getPayment.
// GoPay webhook obvykle obsahuje pouze id + parent_id v query stringu.
// ---------------------------------------------------------------------------
export async function handleGopayWebhook(
  payload: GopayWebhookPayload,
  deps: ServiceDeps,
): Promise<{ statusUpdated: boolean; newStatus: GopayPaymentStatus }> {
  const { db, kafka, gopay } = deps;

  if (!payload.id) {
    throw new GopayError('GOPAY_INVALID_WEBHOOK');
  }

  const [row] = await db.query<GopayPaymentRow>(
    `SELECT * FROM payments.gopay_payments WHERE external_payment_id = $1 LIMIT 1`,
    [payload.id],
  );

  if (!row) {
    throw new GopayError('GOPAY_PAYMENT_NOT_FOUND');
  }

  // Anti-spoofing: re-fetch skutečného stavu z GoPay API.
  const fresh = await gopay.getPayment(payload.id);
  const newStatus = normalizeStatus(fresh.state);
  const statusUpdated = newStatus !== row.status;

  // ---------------------------------------------------------------------------
  // P0 FIX: synchronně aktualizujeme i orders.orders (viz bank-reconciliation).
  // Předpokládané sloupce v orders.orders:
  //   id (PK), status, stripe_payment_intent_id, amount_hellers, currency
  // GoPay dříve neměl vazbu na objednávku — status updatujeme přes row.order_id.
  // Idempotence: WHERE status IN ('pending','awaiting_payment') zaručí, že
  // opakovaný webhook nic nepřepíše. Pokud se neupdatuje žádný řádek, logujeme
  // varování, ale nevyhazujeme chybu (webhook musí vrátit 200 GoPay).
  // ---------------------------------------------------------------------------
  let orderStatusTarget: 'paid' | 'cancelled' | 'refunded' | null = null;
  if (newStatus === 'PAID' || newStatus === 'AUTHORIZED') {
    orderStatusTarget = 'paid';
  } else if (newStatus === 'CANCELED' || newStatus === 'TIMEOUTED') {
    orderStatusTarget = 'cancelled';
  } else if (newStatus === 'REFUNDED' || newStatus === 'PARTIALLY_REFUNDED') {
    orderStatusTarget = 'refunded';
  }

  await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE payments.gopay_payments
         SET status = $1,
             payment_instrument = COALESCE($2, payment_instrument),
             raw_last_status = $3,
             updated_at = NOW()
       WHERE id = $4`,
      [newStatus, fresh.payment_instrument ?? null, JSON.stringify(fresh), row.id],
    );

    if (orderStatusTarget === 'paid') {
      // Idempotentní update: zamění pouze objednávky čekající na platbu.
      const updatedRows = await tx.query<{ id: string }>(
        `UPDATE orders.orders
            SET status = 'paid'
          WHERE id = $1 AND status IN ('pending', 'awaiting_payment')
          RETURNING id`,
        [row.order_id],
      );
      if (!updatedRows || updatedRows.length === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[gopay-webhook] Objednávka ${row.order_id} již byla zaplacena nebo není ve stavu pending (idempotent no-op).`,
        );
      }
    } else if (orderStatusTarget === 'cancelled') {
      await tx.execute(
        `UPDATE orders.orders
            SET status = 'cancelled'
          WHERE id = $1 AND status IN ('pending', 'awaiting_payment')`,
        [row.order_id],
      );
    } else if (orderStatusTarget === 'refunded') {
      await tx.execute(
        `UPDATE orders.orders
            SET status = 'refunded'
          WHERE id = $1 AND status = 'paid'`,
        [row.order_id],
      );
    }
  });

  if (statusUpdated) {
    const topic =
      newStatus === 'PAID'
        ? 'gopay.payment.paid'
        : newStatus === 'REFUNDED' || newStatus === 'PARTIALLY_REFUNDED'
          ? 'gopay.payment.refunded'
          : newStatus === 'CANCELED' || newStatus === 'TIMEOUTED'
            ? 'gopay.payment.failed'
            : 'gopay.payment.created';

    await kafka.send(topic, {
      id: row.id,
      orderId: row.order_id,
      externalPaymentId: payload.id,
      previousStatus: row.status,
      newStatus,
    });
  }

  // After order marked as paid, trigger ticket issuance pipeline (fire-and-forget).
  // Idempotent endpoint — safe to retry. If this fails, a cron picks up unfulfilled orders.
  if (orderStatusTarget === 'paid' && statusUpdated) {
    fetch(`${process.env.INTERNAL_API_BASE_URL ?? ''}/api/internal/order-completed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-auth': process.env.INTERNAL_SERVICE_TOKEN ?? '',
      },
      body: JSON.stringify({ orderId: row.order_id }),
    }).catch((err) =>
      // eslint-disable-next-line no-console
      console.error('[gopay] Failed to trigger order-completed pipeline', err),
    );
  }

  return { statusUpdated, newStatus };
}

// ---------------------------------------------------------------------------
// refundGopayPayment
// ---------------------------------------------------------------------------
export async function refundGopayPayment(
  paymentId: string,
  amountHalire: number,
  deps: ServiceDeps,
): Promise<{ refunded: boolean }> {
  if (!Number.isInteger(amountHalire) || amountHalire <= 0) {
    throw new GopayError('GOPAY_INVALID_AMOUNT');
  }

  const { db, kafka, gopay } = deps;

  const [row] = await db.query<GopayPaymentRow>(
    `SELECT * FROM payments.gopay_payments WHERE id = $1 OR external_payment_id = $1 LIMIT 1`,
    [paymentId],
  );

  if (!row) {
    throw new GopayError('GOPAY_PAYMENT_NOT_FOUND');
  }

  if (!row.external_payment_id) {
    throw new GopayError('GOPAY_PAYMENT_NOT_FOUND', 'Platba nemá external_payment_id.');
  }

  if (amountHalire > row.amount_halire) {
    throw new GopayError('GOPAY_INVALID_AMOUNT', 'Refund přesahuje původní částku.');
  }

  const result = await gopay.refundPayment(row.external_payment_id, amountHalire);
  const refunded = result.result === 'FINISHED' || result.result === 'ACCEPTED';

  if (refunded) {
    const fullRefund = amountHalire >= row.amount_halire;
    const newStatus: GopayPaymentStatus = fullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

    await db.transaction(async (tx) => {
      await tx.execute(
        `UPDATE payments.gopay_payments
           SET status = $1, updated_at = NOW()
         WHERE id = $2`,
        [newStatus, row.id],
      );
    });

    await kafka.send('gopay.payment.refunded', {
      id: row.id,
      orderId: row.order_id,
      externalPaymentId: row.external_payment_id,
      amountHalire,
      newStatus,
    });
  }

  return { refunded };
}
