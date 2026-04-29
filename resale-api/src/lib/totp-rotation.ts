/**
 * Feature #47 — TOTP secret rotation helper
 *
 * Odděluje TOTP rotaci od resale-listing.service tak, aby šla volat ze
 * tří různých kontextů:
 *   1. resale_purchase — kupující dokončil platbu (handleGopayAuthorized)
 *   2. gift_transfer   — vstupenka byla převedena darem (Feature #48, future)
 *   3. admin_action    — CS / admin manuálně rotoval secret (např. po ztrátě
 *                        zařízení nebo podezření na únik)
 *
 * Logika musí běžet uvnitř existující transakce, proto helper přijímá
 * jakýkoli `DbAdapter` (typicky `tx` z `db.transaction()`).
 *
 * Audit trail: každá rotace zapíše řádek do tickets.ticket_transfer_log
 * s OBĚMA secrety (starým i novým, oba zašifrované) — to je důkazní materiál
 * pro případné finanční dispute, kdy je třeba prokázat, kdy přesně se QR
 * vyměnilo a proč.
 *
 * Anti-replay: po rotaci je v tickets.tickets pouze nový secret a IV.
 * Jakýkoli starý TOTP kód vygenerovaný z původního secretu selže při
 * verifyTOTP, protože decryptSecret(novyShifrText) vrátí jiný plaintext —
 * tím pádem HMAC-SHA1(starySecret, T) ≠ HMAC-SHA1(novySecret, T) a TOTP
 * validace neprojde. Old QR je tedy okamžitě neplatné.
 */

import { randomBytes } from 'crypto';
import { encryptSecret } from '@tixly/crypto';
import type { DbAdapter, DbRow, EventBusAdapter } from '../types/resale.js';
import { TotpRotationFailedError } from './resale-errors.js';

export type RotationReason = 'resale_purchase' | 'gift_transfer' | 'admin_action';

export interface RotationResult {
  /** UUID nově vloženého řádku v tickets.ticket_transfer_log */
  transferLogId: string;
  /** Čas, kdy byla rotace provedena (DB NOW()) */
  rotatedAt: Date;
  /** Nový (stále zašifrovaný) secret + IV — vrácen pro testy a debugging */
  newEncrypted: Buffer;
  newIv: Buffer;
}

interface CurrentTicketRow extends DbRow {
  id: string;
  totp_secret_encrypted: Buffer;
  totp_secret_iv: Buffer;
}

interface InsertedLogRow extends DbRow {
  id: string;
  transferred_at: string;
}

/**
 * Vygeneruje nový TOTP secret, zašifruje ho, atomicky aktualizuje
 * tickets.tickets a zapíše audit řádek do tickets.ticket_transfer_log.
 *
 * **Musí běžet uvnitř transakce** — volající typicky předá `tx` z
 * `db.transaction(async (tx) => { ... })`. Pokud rotace selže (např. ticket
 * neexistuje), vyhodí `TotpRotationFailedError` a celá vnější transakce se
 * rolne zpět.
 *
 * Po commitu transakce je možné publikovat Kafka event `ticket.totp_rotated`
 * (fire-and-forget) — viz `publishRotationEvent` níže. Volání emitu je mimo
 * transakci, aby Kafka výpadek nezpůsobil rollback DB stavu.
 */
export async function rotateTicketTotpSecret(
  ticketId: string,
  reason: RotationReason,
  actorUserId: string,
  db: DbAdapter,
  /** Volitelné: kontext-specifický listing_id (resale flow). U gift/admin = null. */
  listingId: string | null = null,
): Promise<RotationResult> {
  // 1. Načti aktuální (starý) secret + IV — FOR UPDATE drží řádek do konce transakce.
  const currentRows = await db.query<CurrentTicketRow>(
    `SELECT id, totp_secret_encrypted, totp_secret_iv
     FROM tickets.tickets
     WHERE id = $1
     FOR UPDATE`,
    [ticketId],
  );

  if (currentRows.length === 0) {
    throw new TotpRotationFailedError(ticketId, 'vstupenka nenalezena');
  }

  const current = currentRows[0];

  // 2. Vygeneruj nový secret. RFC 6238 doporučuje 160 bitů (20 B) pro HMAC-SHA1,
  //    ale platforma standardně používá 32 B (256 bitů) — držíme se toho kvůli
  //    konzistenci se sellovým flow v handleGopayAuthorized.
  const newRawSecret = randomBytes(32);

  let newEncrypted: Buffer;
  let newIv: Buffer;
  try {
    const encResult = await encryptSecret(newRawSecret, ticketId);
    newEncrypted = encResult.encrypted;
    newIv = encResult.iv;
  } catch (err) {
    throw new TotpRotationFailedError(
      ticketId,
      `chyba šifrování: ${(err as Error).message}`,
    );
  }

  // 3. UPDATE ticketu — od této chvíle starý secret v DB neexistuje
  //    a jakýkoli starý QR kód selže při verifyTOTP (anti-replay).
  await db.query(
    `UPDATE tickets.tickets
     SET totp_secret_encrypted = $1,
         totp_secret_iv        = $2,
         transfer_count        = COALESCE(transfer_count, 0) + 1,
         updated_at            = NOW()
     WHERE id = $3`,
    [newEncrypted, newIv, ticketId],
  );

  // 4. Audit log: starý + nový secret + reason + actor
  let inserted: InsertedLogRow[];
  try {
    inserted = await db.query<InsertedLogRow>(
      `INSERT INTO tickets.ticket_transfer_log
         (listing_id, ticket_id,
          old_totp_secret_encrypted, old_totp_secret_iv,
          new_totp_secret_encrypted, new_totp_secret_iv,
          reason, actor_user_id, transferred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id, transferred_at`,
      [
        listingId,
        ticketId,
        current.totp_secret_encrypted,
        current.totp_secret_iv,
        newEncrypted,
        newIv,
        reason,
        actorUserId,
      ],
    );
  } catch (err) {
    throw new TotpRotationFailedError(
      ticketId,
      `INSERT do ticket_transfer_log selhal: ${(err as Error).message}`,
    );
  }

  if (inserted.length === 0) {
    throw new TotpRotationFailedError(ticketId, 'audit log nevrátil řádek');
  }

  return {
    transferLogId: inserted[0].id,
    rotatedAt: new Date(inserted[0].transferred_at),
    newEncrypted,
    newIv,
  };
}

/**
 * Fire-and-forget publikace `ticket.totp_rotated` Kafka eventu.
 * Volá se PO commitu DB transakce — pokud Kafka shodí, DB stav už je správný
 * a downstream konzument (Feature #41 wallet pass push) si event případně
 * dotáhne přes outbox / replay.
 */
export async function publishRotationEvent(
  eventBus: EventBusAdapter,
  ticketId: string,
  rotatedAt: Date,
  reason: RotationReason,
): Promise<void> {
  try {
    await eventBus.publish('ticket.totp_rotated', {
      ticketId,
      rotatedAt: rotatedAt.toISOString(),
      reason,
    });
  } catch (err) {
    // Fire-and-forget — pouze logujeme, nezpůsobíme rollback.
    console.error(
      `[totp-rotation] Failed to publish ticket.totp_rotated for ${ticketId}:`,
      err,
    );
  }
}
