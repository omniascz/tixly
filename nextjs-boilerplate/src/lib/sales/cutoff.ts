/**
 * Uzávěrka prodeje (kolo 7, C-29) — jedno místo pravdy pro všechny cesty, které zakládají objednávku.
 *
 *   online      (kupec: checkout, mobilní platba, držení sedadla, kiosk, odkazy/partneři kupce …)
 *               → prodej končí v `sales_end_at`; když není nastaven, v `date_start` (začátek akce).
 *   box_office  (pokladna/POS obsluhy pořadatele, prodejci a partneři na místě)
 *               → do konce akce: `date_end`, a když není, `date_start + 12 h`.
 *
 * Doplacení objednávky založené PŘED uzávěrkou se tu nekontroluje — řídí ho rezervační lhůta
 * objednávky (webhook / potvrzení platby uzávěrku záměrně neřeší).
 */
import { NextResponse } from 'next/server';

export type SalesChannel = 'online' | 'box_office';

export interface SalesWindowEvent {
  date_start: string | Date;
  date_end?: string | Date | null;
  sales_end_at?: string | Date | null;
}

const BOX_OFFICE_FALLBACK_MS = 12 * 60 * 60 * 1000;

const toDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v));

/** Konec online prodeje: sales_end_at, jinak začátek akce. */
export function onlineSalesEndsAt(ev: SalesWindowEvent): Date {
  return ev.sales_end_at ? toDate(ev.sales_end_at) : toDate(ev.date_start);
}

/** Konec prodeje na pokladně: konec akce, jinak začátek + 12 h. */
export function boxOfficeSalesEndsAt(ev: SalesWindowEvent): Date {
  return ev.date_end ? toDate(ev.date_end) : new Date(toDate(ev.date_start).getTime() + BOX_OFFICE_FALLBACK_MS);
}

export function salesEndsAt(ev: SalesWindowEvent, channel: SalesChannel): Date {
  return channel === 'online' ? onlineSalesEndsAt(ev) : boxOfficeSalesEndsAt(ev);
}

/** Prodej je otevřený do okamžiku uzávěrky (uzávěrka sama už je po prodeji). */
export function isSalesOpen(ev: SalesWindowEvent, channel: SalesChannel, now: Date = new Date()): boolean {
  return now.getTime() < salesEndsAt(ev, channel).getTime();
}

/**
 * Validace nastavení pořadatele: uzávěrka online prodeje nesmí být po konci akce.
 * Když konec akce není zadán, je hranicí konec prodeje na pokladně (začátek + 12 h).
 * Vrací českou chybovou hlášku, nebo null.
 */
export function validateSalesEndAt(salesEndAt: string | Date | null | undefined, ev: Omit<SalesWindowEvent, 'sales_end_at'>): string | null {
  if (!salesEndAt) return null;
  const s = toDate(salesEndAt);
  if (Number.isNaN(s.getTime())) return 'Neplatné datum konce prodeje.';
  const limit = boxOfficeSalesEndsAt(ev);
  if (s.getTime() > limit.getTime()) {
    return ev.date_end
      ? 'Konec online prodeje nesmí být po konci akce.'
      : 'Konec online prodeje nesmí být víc než 12 hodin po začátku akce (konec akce není zadán).';
  }
  return null;
}

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

export const SALES_CLOSED_MESSAGE = 'Prodej ukončen';

/**
 * Serverová kontrola pro routy: načte akci a vrátí 409 SALES_CLOSED, když je prodej daného kanálu
 * uzavřený; jinak null. Neexistující akci nechává na routě (vrací null).
 */
export async function salesClosedResponse(
  q: Queryable,
  eventId: string,
  channel: SalesChannel,
  now: Date = new Date(),
): Promise<NextResponse | null> {
  // Neplatné ID nechává na routě (jinak by dotaz spadl na 22P02 → 500).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) return null;
  const r = await q.query(`SELECT date_start, date_end, sales_end_at FROM catalog.events WHERE id = $1`, [eventId]);
  const ev = r.rows[0] as SalesWindowEvent | undefined;
  if (!ev) return null;
  if (isSalesOpen(ev, channel, now)) return null;
  return NextResponse.json(
    {
      error: 'SALES_CLOSED',
      message: SALES_CLOSED_MESSAGE,
      salesEndedAt: salesEndsAt(ev, channel).toISOString(),
    },
    { status: 409 },
  );
}
