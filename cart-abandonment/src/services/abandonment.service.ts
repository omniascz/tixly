// Abandonment Service — detekce opuštěných košíků a sekvenční recovery kampaň.
// Spouští se cronem každých 5 minut.
//
// Sekvenční triggery:
//   Stage 1 (30 min):  "Zapomněl/a jsi něco v košíku?"
//   Stage 2 (24 h):    "Máš stále zájem?"
//   Stage 3 (72 h):    "Poslední šance + sleva 10 %"
//
// Pro každý stage platí:
//   - přeskoč pokud status = 'converted' (stop-on-purchase)
//   - přeskoč pokud user.stop_marketing = true (stop-on-unsubscribe)
//   - idempotence: každý stageN_sent_at se nastaví atomicky pouze pokud byl NULL
//
// Stage 3 navíc generuje jednorázový slevový kód navázaný na usera.

import { randomBytes } from 'node:crypto';
import { generateRecoveryToken } from '../lib/recovery-token.js';
import {
  abandonStage1Email,
  abandonStage2Email,
  abandonStage3Email,
} from '../lib/email-templates.js';
import type { AbVariant, CartItem } from '../types/cart.types.js';
import { withTenantContext } from '@tixly/rls-multitenancy';
import type { DbAdapter } from '@tixly/rls-multitenancy';

interface EmailAdapter { send(to: string, subject: string, html: string): Promise<void>; }
interface KafkaAdapter { send(topic: string, payload: unknown): Promise<void>; }

export interface ServiceDeps {
  db: DbAdapter;
  email: EmailAdapter;
  kafka: KafkaAdapter;
}

export interface SequentialJobResult {
  stage1: number;
  stage2: number;
  stage3: number;
}

// ---------------------------------------------------------------------------
// Shared row shape pro všechny stages
// ---------------------------------------------------------------------------
interface AbandonedRow {
  id: string;
  user_id: string;
  event_id: string;
  items: CartItem[];
  total_amount: number;
  ab_variant: AbVariant;
  user_email: string;
  user_first_name: string | null;
  event_name: string;
  event_start_at: Date | null;
  stop_marketing: boolean;
}

const STAGE1_MINUTES = 30;
const STAGE2_HOURS = 24;
const STAGE3_HOURS = 72;
const DISCOUNT_PCT = 10;
const STAGE3_CODE_TTL_HOURS = 48;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function summarizeItems(items: CartItem[]): string {
  return items
    .map((i) => `${i.quantity}× ${i.ticketTypeName}`)
    .join(', ');
}

function buildRecoveryUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tixly.cz';
  return `${base}/cs/kosik/obnovit?token=${encodeURIComponent(token)}`;
}

function generateDiscountCode(): string {
  // Krátký, čitelný kód: CART-XXXXXX
  return `CART-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function isEventStartingSoon(eventStart: Date | null, now: Date): boolean {
  if (!eventStart) return false;
  const diffMs = eventStart.getTime() - now.getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return diffMs > 0 && diffMs < sevenDays;
}

// ---------------------------------------------------------------------------
// processAbandonedCarts — cron entry point (sekvenční kampaň)
// ---------------------------------------------------------------------------
export async function processAbandonedCarts(
  now: Date,
  deps: ServiceDeps,
): Promise<SequentialJobResult> {
  const stage1 = await runStage1(now, deps);
  const stage2 = await runStage2(now, deps);
  const stage3 = await runStage3(now, deps);
  return { stage1, stage2, stage3 };
}

// ---------------------------------------------------------------------------
// Stage 1 — 30 min po updated_at, nikdy neodeslaný stage1
// ---------------------------------------------------------------------------
async function runStage1(now: Date, deps: ServiceDeps): Promise<number> {
  return withTenantContext(deps.db, { role: 'service' }, async (db) => {
    const rows = await db.query<AbandonedRow>(
      `SELECT c.id, c.user_id, c.event_id, c.items, c.total_amount, c.ab_variant,
              u.email AS user_email, u.first_name AS user_first_name,
              COALESCE(u.stop_marketing, false) AS stop_marketing,
              e.name AS event_name, e.start_at AS event_start_at
         FROM orders.abandoned_carts c
         JOIN identity.users u ON u.id = c.user_id
         JOIN catalog.events e ON e.id = c.event_id
        WHERE c.status IN ('active','abandoned')
          AND c.stage1_sent_at IS NULL
          AND c.updated_at < $1 - INTERVAL '${STAGE1_MINUTES} minutes'
          AND COALESCE(u.stop_marketing, false) = false
        LIMIT 200`,
      [now],
    );

    let sent = 0;
    for (const row of rows) {
      try {
        // Idempotentní claim: pouze pokud stage1_sent_at je stále NULL
        const token = await generateRecoveryToken(row.id, row.user_id);
        const claimed = await db.execute(
          `UPDATE orders.abandoned_carts
              SET status = 'abandoned',
                  recovery_token = COALESCE(recovery_token, $1),
                  stage1_sent_at = $2
            WHERE id = $3
              AND stage1_sent_at IS NULL
              AND status <> 'converted'`,
          [token, now, row.id],
        );
        if (!claimed || (typeof claimed === 'object' && 'rowCount' in claimed && claimed.rowCount === 0)) {
          continue;
        }

        const email = abandonStage1Email({
          firstName: row.user_first_name ?? '',
          itemSummary: summarizeItems(row.items),
          recoveryUrl: buildRecoveryUrl(token),
        });
        await deps.email.send(row.user_email, email.subject, email.html);

        deps.kafka.send('tixly.cart.email.sent', {
          cartId: row.id, userId: row.user_id, stage: 1,
        }).catch(() => {});

        sent++;
      } catch {
        // Chyba jednoho emailu nezastaví dávku
      }
    }
    return sent;
  });
}

// ---------------------------------------------------------------------------
// Stage 2 — 24h po stage1_sent_at
// ---------------------------------------------------------------------------
async function runStage2(now: Date, deps: ServiceDeps): Promise<number> {
  return withTenantContext(deps.db, { role: 'service' }, async (db) => {
    const rows = await db.query<AbandonedRow>(
      `SELECT c.id, c.user_id, c.event_id, c.items, c.total_amount, c.ab_variant,
              u.email AS user_email, u.first_name AS user_first_name,
              COALESCE(u.stop_marketing, false) AS stop_marketing,
              e.name AS event_name, e.start_at AS event_start_at
         FROM orders.abandoned_carts c
         JOIN identity.users u ON u.id = c.user_id
         JOIN catalog.events e ON e.id = c.event_id
        WHERE c.status = 'abandoned'
          AND c.stage1_sent_at IS NOT NULL
          AND c.stage2_sent_at IS NULL
          AND c.stage1_sent_at < $1 - INTERVAL '${STAGE2_HOURS} hours'
          AND COALESCE(u.stop_marketing, false) = false
        LIMIT 200`,
      [now],
    );

    let sent = 0;
    for (const row of rows) {
      try {
        const token = await generateRecoveryToken(row.id, row.user_id);
        const claimed = await db.execute(
          `UPDATE orders.abandoned_carts
              SET stage2_sent_at = $1
            WHERE id = $2
              AND stage2_sent_at IS NULL
              AND status <> 'converted'`,
          [now, row.id],
        );
        if (!claimed || (typeof claimed === 'object' && 'rowCount' in claimed && claimed.rowCount === 0)) {
          continue;
        }

        const email = abandonStage2Email({
          firstName: row.user_first_name ?? '',
          itemSummary: summarizeItems(row.items),
          recoveryUrl: buildRecoveryUrl(token),
          eventStartingSoon: isEventStartingSoon(row.event_start_at, now),
        });
        await deps.email.send(row.user_email, email.subject, email.html);

        deps.kafka.send('tixly.cart.email.sent', {
          cartId: row.id, userId: row.user_id, stage: 2,
        }).catch(() => {});

        sent++;
      } catch {
        // continue
      }
    }
    return sent;
  });
}

// ---------------------------------------------------------------------------
// Stage 3 — 72h po stage2_sent_at, generuje jednorázovou slevu
// ---------------------------------------------------------------------------
async function runStage3(now: Date, deps: ServiceDeps): Promise<number> {
  return withTenantContext(deps.db, { role: 'service' }, async (db) => {
    const rows = await db.query<AbandonedRow>(
      `SELECT c.id, c.user_id, c.event_id, c.items, c.total_amount, c.ab_variant,
              u.email AS user_email, u.first_name AS user_first_name,
              COALESCE(u.stop_marketing, false) AS stop_marketing,
              e.name AS event_name, e.start_at AS event_start_at
         FROM orders.abandoned_carts c
         JOIN identity.users u ON u.id = c.user_id
         JOIN catalog.events e ON e.id = c.event_id
        WHERE c.status = 'abandoned'
          AND c.stage2_sent_at IS NOT NULL
          AND c.stage3_sent_at IS NULL
          AND c.stage2_sent_at < $1 - INTERVAL '${STAGE3_HOURS} hours'
          AND COALESCE(u.stop_marketing, false) = false
        LIMIT 200`,
      [now],
    );

    let sent = 0;
    for (const row of rows) {
      try {
        const token = await generateRecoveryToken(row.id, row.user_id);
        const code = generateDiscountCode();
        const expiresAt = new Date(now.getTime() + STAGE3_CODE_TTL_HOURS * 3600 * 1000);

        // Atomicky: claim stage3 + insert slevového kódu (jednorázový, navázaný na usera)
        const claimed = await db.execute(
          `UPDATE orders.abandoned_carts
              SET stage3_sent_at = $1,
                  stage3_discount_code = $2
            WHERE id = $3
              AND stage3_sent_at IS NULL
              AND status <> 'converted'`,
          [now, code, row.id],
        );
        if (!claimed || (typeof claimed === 'object' && 'rowCount' in claimed && claimed.rowCount === 0)) {
          continue;
        }

        await db.execute(
          `INSERT INTO marketing.discount_codes
             (code, user_id, event_id, cart_id, discount_pct, max_uses, uses, expires_at)
           VALUES ($1, $2, $3, $4, $5, 1, 0, $6)
           ON CONFLICT (code) DO NOTHING`,
          [code, row.user_id, row.event_id, row.id, DISCOUNT_PCT, expiresAt],
        );

        const email = abandonStage3Email({
          firstName: row.user_first_name ?? '',
          itemSummary: summarizeItems(row.items),
          recoveryUrl: buildRecoveryUrl(token),
          discountCode: code,
          discountPct: DISCOUNT_PCT,
        });
        await deps.email.send(row.user_email, email.subject, email.html);

        deps.kafka.send('tixly.cart.email.sent', {
          cartId: row.id, userId: row.user_id, stage: 3, discountCode: code,
        }).catch(() => {});

        sent++;
      } catch {
        // continue
      }
    }
    return sent;
  });
}

// ---------------------------------------------------------------------------
// markCartConverted — volá se z order.created Kafka konzumenta
// Zastaví sekvenci pro všechny košíky daného usera na dané akci.
// ---------------------------------------------------------------------------
export async function markCartConverted(
  cartId: string,
  deps: ServiceDeps,
): Promise<void> {
  await withTenantContext(deps.db, { role: 'service' }, async (db) => {
    await db.execute(
      `UPDATE orders.abandoned_carts
          SET status = 'converted', converted_at = NOW()
        WHERE id = $1 AND status <> 'converted'`,
      [cartId],
    );
  });
  deps.kafka.send('tixly.cart.converted', { cartId }).catch(() => {});
}

// ---------------------------------------------------------------------------
// getAbandonmentStats — přehled pro A/B analýzu (promotér/admin)
// ---------------------------------------------------------------------------
export async function getAbandonmentStats(
  deps: ServiceDeps,
  eventId: string,
): Promise<{
  variant: AbVariant;
  abandoned: number;
  recovered: number;
  converted: number;
  recoveryRate: number;
}[]> {
  return withTenantContext(deps.db, { role: 'service' }, async (db) => {
    const rows = await db.query<{
      ab_variant: AbVariant;
      abandoned: number;
      recovered: number;
      converted: number;
    }>(
      `SELECT ab_variant,
              COUNT(*) FILTER (WHERE status = 'abandoned') AS abandoned,
              COUNT(*) FILTER (WHERE status = 'recovered') AS recovered,
              COUNT(*) FILTER (WHERE status = 'converted') AS converted
         FROM orders.abandoned_carts
        WHERE event_id = $1
        GROUP BY ab_variant`,
      [eventId],
    );

    return rows.map((r) => ({
      variant: r.ab_variant,
      abandoned: r.abandoned,
      recovered: r.recovered,
      converted: r.converted,
      recoveryRate: r.abandoned > 0 ? Math.round((r.recovered / r.abandoned) * 100) : 0,
    }));
  });
}
