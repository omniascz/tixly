/**
 * ForgeMsg emit — append a ticketing domain event to the transactional outbox.
 *
 * Cheap and non-blocking: one INSERT, committed with the surrounding request.
 * The forgemsg-dispatch cron later POSTs pending rows to ForgeMsg. Callers MUST
 * wrap emit in try/catch so a logging failure never breaks the business path
 * (ticket delivery etc.).
 *
 * `promoterId` routes the event to that theater's ForgeMsg org (resolved to an
 * API key in the dispatcher); null uses the platform default key.
 */
import { db } from '@/lib/db/rls-pool';

export type ForgeMsgEventType =
  | 'contact_sync'
  | 'order_paid'
  | 'order_refunded'
  | 'event_attended'
  | 'cart_abandoned'
  | 'event_upsert'
  | 'event_changed'
  | 'subscription_past_due'
  | 'waitlist_freed'
  | 'lottery_won';

export interface ForgeMsgContact {
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  locale?: string;
}

export interface ForgeMsgEventBody {
  type: ForgeMsgEventType;
  contact?: ForgeMsgContact;
  event?: {
    externalId: string;
    title?: string;
    category?: string;
    subcategory?: string;
    venueName?: string;
    venueCity?: string;
    currency?: string;
    url?: string;
    startsAt?: string;
    status?: string;
    unsoldSeats?: number;
    unsoldByTier?: Record<string, number>;
    tags?: string[];
  };
  order?: { orderId?: string; amount?: number; currency?: string; seats?: number };
  occurredAt?: string;
  /** Deep links / extras that become merge tags in ForgeMsg (cart_url, …). */
  payload?: Record<string, unknown>;
}

/** Split a single "First Last" name into first/last (best-effort). */
export function splitName(name?: string | null): { firstName?: string; lastName?: string } {
  if (!name) return {};
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export async function emitForgeMsg(
  body: ForgeMsgEventBody,
  promoterId?: string | null,
): Promise<void> {
  await db().query(
    `INSERT INTO public.forgemsg_outbox (promoter_id, event_type, payload)
     VALUES ($1, $2, $3)`,
    [promoterId ?? null, body.type, JSON.stringify(body)],
  );
}
