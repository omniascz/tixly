/**
 * Agent Lane — klíče a validace delegovaného mandátu.
 *
 * Agent se autentizuje API klíčem (ukládáme jen sha256 hash). Nákup smí jen v mezích
 * mandátu, který mu udělil OVĚŘENÝ ČLOVĚK (max cena/počet/akce/platnost). Fér-pravidla
 * platí per člověk-vlastník → whitelisted agent nemůže scalpovat.
 */
import { createHash, randomBytes } from 'crypto';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateAgentKey(): { key: string; hash: string } {
  const key = `agt_${base64url(randomBytes(24))}`;
  return { key, hash: hashKey(key) };
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export interface MandateRow {
  id: string;
  user_id: string;
  event_id: string | null;
  max_price_minor: number;
  max_qty: number;
  used_qty: number;
  status: string;
  expires_at: string;
}

export interface PurchaseAsk {
  eventId: string;
  qty: number;
  unitPriceMinor: number;
}

export type MandateCheck =
  | { ok: true; remainingQty: number }
  | { ok: false; reason: string };

/** Ověří, že mandát pokrývá požadovaný nákup. Čistá funkce nad načteným řádkem. */
export function checkMandate(m: MandateRow | undefined, ask: PurchaseAsk, now: Date): MandateCheck {
  if (!m) return { ok: false, reason: 'NO_MANDATE' };
  if (m.status !== 'active') return { ok: false, reason: 'MANDATE_NOT_ACTIVE' };
  if (new Date(m.expires_at).getTime() < now.getTime()) return { ok: false, reason: 'MANDATE_EXPIRED' };
  if (m.event_id !== null && m.event_id !== ask.eventId) return { ok: false, reason: 'MANDATE_EVENT_MISMATCH' };
  if (ask.unitPriceMinor > m.max_price_minor) return { ok: false, reason: 'PRICE_OVER_MANDATE' };
  const remaining = m.max_qty - m.used_qty;
  if (ask.qty > remaining) return { ok: false, reason: 'QTY_OVER_MANDATE' };
  return { ok: true, remainingQty: remaining };
}
