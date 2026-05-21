/**
 * Hot Event mode enforcement — anti-scalp gates při checkoutu.
 *
 * Když event má hot_event_mode (Sheeran-style), zkontroluj:
 *   1. max_tickets_per_buyer cap (per user_id i per phone_e164)
 *   2. phone validation (phone musí být verified)
 *   3. require_phone_binding → bind ticket na phone po PAID
 *
 * Vrací { allowed, reason?, currentCount?, cap? }
 */
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface HotEventConfig {
  hotEventMode: boolean;
  maxTicketsPerBuyer: number | null;
  qrRevealMinutesBefore: number;
  requireTanValidation: boolean;
  requirePhoneBinding: boolean;
  noGiftingMode: boolean;
  requirePhotoId: boolean;
}

export async function getEventHotConfig(eventId: string): Promise<HotEventConfig | null> {
  const r = await db().query<{
    hot_event_mode: boolean;
    max_tickets_per_buyer: number | null;
    qr_reveal_minutes_before: number;
    require_tan_validation: boolean;
    require_phone_binding: boolean;
    no_gifting_mode: boolean;
    require_photo_id: boolean;
  }>(
    `SELECT hot_event_mode, max_tickets_per_buyer, qr_reveal_minutes_before,
            require_tan_validation, require_phone_binding,
            no_gifting_mode, require_photo_id
       FROM catalog.events
      WHERE id = $1`,
    [eventId],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    hotEventMode: row.hot_event_mode,
    maxTicketsPerBuyer: row.max_tickets_per_buyer,
    qrRevealMinutesBefore: row.qr_reveal_minutes_before,
    requireTanValidation: row.require_tan_validation,
    requirePhoneBinding: row.require_phone_binding,
    noGiftingMode: row.no_gifting_mode,
    requirePhotoId: row.require_photo_id,
  };
}

export interface BuyerCapResult {
  allowed: boolean;
  reason?: 'buyer_cap_exceeded' | 'phone_cap_exceeded' | 'no_cap';
  currentCount?: number;
  requestedCount?: number;
  cap?: number;
}

/**
 * Check buyer cap. Returns allowed=true pokud (current + requested) <= cap.
 * Kontroluje per user_id i per phone (pokud zadán).
 */
export async function checkBuyerCap(input: {
  eventId: string;
  userId: string;
  phoneE164?: string | null;
  requestedTickets: number;
}): Promise<BuyerCapResult> {
  const config = await getEventHotConfig(input.eventId);
  if (!config || config.maxTicketsPerBuyer === null) {
    return { allowed: true, reason: 'no_cap' };
  }
  const cap = config.maxTicketsPerBuyer;

  // 1. User-level count
  const userCount = await db().query<{ tickets_count: number }>(
    `SELECT tickets_count FROM orders.buyer_event_purchases
      WHERE user_id = $1 AND event_id = $2`,
    [input.userId, input.eventId],
  );
  const userCurrent = userCount.rows[0]?.tickets_count ?? 0;

  if (userCurrent + input.requestedTickets > cap) {
    return {
      allowed: false,
      reason: 'buyer_cap_exceeded',
      currentCount: userCurrent,
      requestedCount: input.requestedTickets,
      cap,
    };
  }

  // 2. Phone-level count (anti-multi-account)
  if (input.phoneE164) {
    const phoneCount = await db().query<{ tickets_count: number }>(
      `SELECT tickets_count FROM orders.phone_event_purchases
        WHERE phone_e164 = $1 AND event_id = $2`,
      [input.phoneE164, input.eventId],
    );
    const phoneCurrent = phoneCount.rows[0]?.tickets_count ?? 0;

    if (phoneCurrent + input.requestedTickets > cap) {
      return {
        allowed: false,
        reason: 'phone_cap_exceeded',
        currentCount: phoneCurrent,
        requestedCount: input.requestedTickets,
        cap,
      };
    }
  }

  return {
    allowed: true,
    currentCount: userCurrent,
    requestedCount: input.requestedTickets,
    cap,
  };
}

/**
 * Increment counters po paid order. Idempotent přes upsert.
 * Volat po orders.orders.status = 'paid' commit.
 */
export async function recordBuyerPurchase(input: {
  userId: string;
  eventId: string;
  phoneE164: string | null;
  ticketsCount: number;
}): Promise<void> {
  await db().query(
    `INSERT INTO orders.buyer_event_purchases (user_id, event_id, tickets_count)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, event_id)
     DO UPDATE SET tickets_count = orders.buyer_event_purchases.tickets_count + EXCLUDED.tickets_count,
                   last_purchase_at = now()`,
    [input.userId, input.eventId, input.ticketsCount],
  );

  if (input.phoneE164) {
    await db().query(
      `INSERT INTO orders.phone_event_purchases (phone_e164, event_id, tickets_count)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone_e164, event_id)
       DO UPDATE SET tickets_count = orders.phone_event_purchases.tickets_count + EXCLUDED.tickets_count,
                     last_purchase_at = now()`,
      [input.phoneE164, input.eventId, input.ticketsCount],
    );
  }
}

/**
 * Když QR má hidden-until-event, vrátí jestli má smysl ho vůbec generovat.
 */
export function isQrRevealed(eventStartIso: string, revealMinutesBefore: number): boolean {
  if (revealMinutesBefore === 0) return true;
  const start = new Date(eventStartIso).getTime();
  const reveal = start - revealMinutesBefore * 60 * 1000;
  return Date.now() >= reveal;
}

export function minutesUntilQrReveal(eventStartIso: string, revealMinutesBefore: number): number {
  if (revealMinutesBefore === 0) return 0;
  const start = new Date(eventStartIso).getTime();
  const reveal = start - revealMinutesBefore * 60 * 1000;
  return Math.max(0, Math.ceil((reveal - Date.now()) / 60_000));
}
