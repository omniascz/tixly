/**
 * Kolo 14 / krok 1 — offline seznam vstupenek termínu pro skener (C-50).
 *
 * Skener si seznam stáhne před otevřením dveří a bez internetu podle něj rozhoduje STEJNĚ jako online validate:
 *   - stav vstupenky (platná / použitá / zrušená) — použitá a zrušená se odmítnou s důvodem, ne „nenalezena";
 *   - kategorie s nárokem (ZTP/P, student…) → „Ověřit průkaz";
 *   - tištěná vstupenka: otisk (SHA-256) očekávaného tokenu TXP1/TXP2 — padělaný podpis neprojde (online: invalid_token);
 *   - politika QR (qr_policy + začátek termínu) → kdy je rotující QR povinné (sdílené qrPolicyDecision);
 *   - rotující QR: předpočítané kódy TOTP na OMEZENÉ okno (TOTP_WINDOW_SLOTS × 30 s od stažení). Tajemství TOTP
 *     zařízení nikdy nedostane — po konci okna jsou kódy bezcenné.
 * Žádné osobní údaje kupců (jména, e-maily, telefony) — jen to, co skener potřebuje k rozhodnutí.
 */
import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { decryptSecret } from '@/lib/crypto';
import { signEventPrintToken, signPrintToken } from '@/lib/tickets/print-token';
import { generateTotpCode } from '@/lib/totp/verify';

export const TOTP_STEP_S = 30;
/** 6 h po stažení (+ 2 min zpět) — dveře se otevírají krátce po stažení seznamu. */
export const TOTP_WINDOW_SLOTS = 6 * 120 + 4;

export interface ManifestTicket {
  /** ticket UUID (malými písmeny) */
  id: string;
  /** v = platná, u = použitá, r = zrušená */
  s: 'v' | 'u' | 'r';
  /** kdy použita (ISO) */
  u?: string | null;
  /** typ vstupenky, kategorie, místo, nárok k ověření */
  tt?: string | null;
  c?: string | null;
  seat?: string | null;
  p?: string | null;
  /** otisky tiskových tokenů (hex, 24 znaků) */
  x1: string;
  x2: string;
  /** TOTP kódy pro sloty totp.from … from+slots-1: base64 z 3bajtových čísel (big-endian) */
  k?: string;
}

export interface OfflineManifest {
  eventId: string;
  generatedAt: string;
  event: { title: string; dateStart: string | null; qrPolicy: string | null };
  totp: { from: number; slots: number; step: number } | null;
  tickets: ManifestTicket[];
  /** zpětná kompatibilita (starší klient): jen platné vstupenky */
  ticketIds: string[];
  count: number;
}

export const tokenFingerprint = (token: string): string => createHash('sha256').update(token).digest('hex').slice(0, 24);

/** Potřebuje politika QR v okně [now, now+okno] rotující kód? (rotating_24h od 24 h před začátkem) */
function totpMayBeRequired(qrPolicy: string | null, dateStart: string | null, untilMs: number): boolean {
  const p = qrPolicy ?? 'rotating_24h';
  if (p === 'rotating_only' || p === 'photo_required') return true;
  if (p === 'rotating_24h') return !dateStart || new Date(dateStart).getTime() - 24 * 3600_000 <= untilMs;
  return false;
}

export async function buildOfflineManifest(client: PoolClient, eventId: string, now = Date.now()): Promise<OfflineManifest> {
  const ev = (await client.query<{ title: string; date_start: string | null; qr_policy: string | null }>(
    `SELECT title, date_start, qr_policy FROM catalog.events WHERE id = $1`, [eventId],
  )).rows[0];
  const rows = (await client.query<{
    id: string; status: string; used_at: string | null; totp_secret_encrypted: Buffer | null; tt: string | null;
    category: string | null; proof: string | null; sector: string | null; row: string | null; seat_number: string | null;
  }>(
    `SELECT t.id, t.status, t.used_at, t.totp_secret_encrypted, tt.name AS tt, t.price_category_name AS category,
            t.proof_required_label AS proof, es.sector, es.row, es.seat_number
       FROM tickets.tickets t
       JOIN orders.orders o ON o.id = t.order_id
       LEFT JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
      WHERE o.event_id = $1 AND t.status IN ('valid', 'used', 'revoked')
      ORDER BY t.id
      LIMIT 100000`,
    [eventId],
  )).rows;

  const from = Math.floor(now / 1000 / TOTP_STEP_S) - 4;
  const withCodes = totpMayBeRequired(ev?.qr_policy ?? null, ev?.date_start ?? null, now + TOTP_WINDOW_SLOTS * TOTP_STEP_S * 1000);
  const tickets: ManifestTicket[] = rows.map((r) => {
    const id = r.id.toLowerCase();
    const t: ManifestTicket = {
      id,
      s: r.status === 'valid' ? 'v' : r.status === 'used' ? 'u' : 'r',
      u: r.used_at ? new Date(r.used_at).toISOString() : null,
      tt: r.tt, c: r.category, p: r.proof,
      seat: r.sector ? `${r.sector}, řada ${r.row}, místo ${r.seat_number}` : null,
      x1: tokenFingerprint(signPrintToken(id)),
      x2: tokenFingerprint(signEventPrintToken(id, eventId)),
    };
    if (withCodes && r.status === 'valid' && r.totp_secret_encrypted) {
      const secret = Buffer.from(decryptSecret(r.totp_secret_encrypted.toString('base64')), 'base64');
      const buf = Buffer.alloc(TOTP_WINDOW_SLOTS * 3);
      for (let i = 0; i < TOTP_WINDOW_SLOTS; i++) {
        buf.writeUIntBE(Number(generateTotpCode(secret, new Date((from + i) * TOTP_STEP_S * 1000))), i * 3, 3);
      }
      t.k = buf.toString('base64');
    }
    return t;
  });
  return {
    eventId,
    generatedAt: new Date(now).toISOString(),
    event: { title: ev?.title ?? '', dateStart: ev?.date_start ? new Date(ev.date_start).toISOString() : null, qrPolicy: ev?.qr_policy ?? null },
    totp: withCodes ? { from, slots: TOTP_WINDOW_SLOTS, step: TOTP_STEP_S } : null,
    tickets,
    ticketIds: tickets.filter((t) => t.s === 'v').map((t) => t.id),
    count: tickets.length,
  };
}
