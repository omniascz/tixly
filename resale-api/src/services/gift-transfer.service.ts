/**
 * Feature #49 — "Daruju vstupenku" (free ticket transfer / gift)
 *
 * Umožňuje držiteli vstupenky bezplatně převést vstupenku na jiný účet.
 * Zajišťuje:
 *   - validaci vlastnictví, statusu a transferable flag
 *   - lookup příjemce podle e-mailu (lowercase)
 *   - rotaci TOTP secretu (původní QR okamžitě neplatné) — sdílený helper
 *     z totp-rotation.ts (Feature #47)
 *   - převod owner_id
 *   - audit log v ticket_transfer_log + gift-specific řádek v gift_transfer_log
 *   - Kafka eventy pro wallet pass push (#41) a e-mail notifikaci příjemci
 *
 * Vše atomicky uvnitř jedné DB transakce. Kafka publish běží AŽ po commitu
 * (fire-and-forget).
 *
 * -- Required (additive) schema for gift transfers — viz migrations/052_gift_transfer.sql
 * -- CREATE TABLE tickets.gift_transfer_log (
 * --   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 * --   ticket_id UUID NOT NULL REFERENCES tickets.tickets(id),
 * --   transfer_log_id UUID REFERENCES tickets.ticket_transfer_log(id),
 * --   from_user_id UUID NOT NULL,
 * --   to_user_id UUID NOT NULL,
 * --   message TEXT,
 * --   transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * -- );
 * -- CREATE INDEX idx_gift_transfer_to ON tickets.gift_transfer_log(to_user_id);
 * -- ALTER TABLE catalog.ticket_types ADD COLUMN IF NOT EXISTS transferable BOOLEAN NOT NULL DEFAULT TRUE;
 */

import { rotateTicketTotpSecret, publishRotationEvent } from '../lib/totp-rotation.js';
import {
  TicketOwnershipError,
  TicketNotValidError,
  RecipientNotFoundError,
  SelfTransferError,
  TransferNotAllowedError,
  TicketAlreadyTransferredError,
} from '../lib/resale-errors.js';
import type { ServiceDeps } from './resale-listing.service.js';
import type { DbRow } from '../types/resale.js';
import { withTenantContext } from '@tixly/rls-multitenancy';

export interface GiftTransferResult {
  ticketId: string;
  oldOwnerId: string;
  newOwnerId: string;
  transferLogId: string;
  transferredAt: Date;
}

interface RecipientRow extends DbRow {
  id: string;
}

interface TicketJoinRow extends DbRow {
  id: string;
  owner_id: string;
  status: string;
  transferable: boolean;
  event_id: string;
}

interface GiftLogRow extends DbRow {
  id: string;
  transferred_at: string;
}

/**
 * Free transfer of a ticket to another user account.
 *
 * @throws RecipientNotFoundError      — recipient e-mail not registered
 * @throws SelfTransferError           — recipient is the sender
 * @throws TicketOwnershipError        — sender is not the ticket owner
 * @throws TicketNotValidError         — ticket status is not 'valid'
 * @throws TransferNotAllowedError     — ticket type has transferable=false
 * @throws TicketAlreadyTransferredError — gift transfer was made in the last 5 minutes
 */
export async function giftTransferTicket(
  ticketId: string,
  fromUserId: string,
  recipientEmail: string,
  message: string | null,
  deps: ServiceDeps,
): Promise<GiftTransferResult> {
  const normalizedEmail = recipientEmail.trim().toLowerCase();

  const result = await withTenantContext(
    deps.db,
    { role: 'buyer', userId: fromUserId },
    async (db) => {
      return db.transaction(async (tx) => {
        // a. Lookup recipient
        const recipientRows = await tx.query<RecipientRow>(
          `SELECT id FROM identity.users WHERE email = $1`,
          [normalizedEmail],
        );

        if (recipientRows.length === 0) {
          throw new RecipientNotFoundError(normalizedEmail);
        }

        const recipientId = recipientRows[0].id;

        if (recipientId === fromUserId) {
          throw new SelfTransferError();
        }

        // b. Load ticket joined with ticket_type + event (FOR UPDATE on ticket)
        const ticketRows = await tx.query<TicketJoinRow>(
          `SELECT t.id, t.owner_id, t.status, tt.transferable, e.id AS event_id
           FROM tickets.tickets t
           JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
           JOIN catalog.events e ON e.id = tt.event_id
           WHERE t.id = $1
           FOR UPDATE`,
          [ticketId],
        );

        if (ticketRows.length === 0) {
          throw new TicketOwnershipError('Vstupenka nenalezena.');
        }

        const ticket = ticketRows[0];

        // c. Ownership
        if (ticket.owner_id !== fromUserId) {
          throw new TicketOwnershipError('Vstupenka nepatří přihlášenému uživateli.');
        }

        // d. Status
        if (ticket.status !== 'valid') {
          throw new TicketNotValidError(
            `Vstupenka má status '${ticket.status}'; darovat lze pouze vstupenky se statusem 'valid'.`,
          );
        }

        // e. Transferable flag
        if (ticket.transferable !== true) {
          throw new TransferNotAllowedError();
        }

        // f. Anti double-tap — žádný gift v posledních 5 minutách
        const recentRows = await tx.query<DbRow>(
          `SELECT 1 FROM tickets.ticket_transfer_log
           WHERE ticket_id = $1 AND reason = 'gift_transfer'
             AND transferred_at > NOW() - INTERVAL '5 minutes'
           LIMIT 1`,
          [ticketId],
        );

        if (recentRows.length > 0) {
          throw new TicketAlreadyTransferredError();
        }

        // g. TOTP rotace + audit log v ticket_transfer_log (sdílený helper)
        const rotation = await rotateTicketTotpSecret(
          ticketId,
          'gift_transfer',
          fromUserId,
          tx,
        );

        // h. Převod vlastnictví
        await tx.query(
          `UPDATE tickets.tickets
           SET owner_id = $1,
               transferred_at = NOW(),
               updated_at = NOW()
           WHERE id = $2`,
          [recipientId, ticketId],
        );

        // i. Gift-specific audit row
        const giftRows = await tx.query<GiftLogRow>(
          `INSERT INTO tickets.gift_transfer_log
             (ticket_id, transfer_log_id, from_user_id, to_user_id, message, transferred_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           RETURNING id, transferred_at`,
          [ticketId, rotation.transferLogId, fromUserId, recipientId, message],
        );

        return {
          ticketId,
          oldOwnerId: fromUserId,
          newOwnerId: recipientId,
          transferLogId: rotation.transferLogId,
          transferredAt: new Date(giftRows[0].transferred_at),
          rotatedAt: rotation.rotatedAt,
        };
      });
    },
  );

  // Po commitu — fire-and-forget Kafka eventy
  await publishRotationEvent(deps.eventBus, ticketId, result.rotatedAt, 'gift_transfer');

  try {
    await deps.eventBus.publish('ticket.gifted', {
      ticketId,
      fromUserId,
      toUserId: result.newOwnerId,
      message,
    });
  } catch (err) {
    console.error(`[gift-transfer] Failed to publish ticket.gifted for ${ticketId}:`, err);
  }

  return {
    ticketId: result.ticketId,
    oldOwnerId: result.oldOwnerId,
    newOwnerId: result.newOwnerId,
    transferLogId: result.transferLogId,
    transferredAt: result.transferredAt,
  };
}
