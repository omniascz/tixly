/**
 * POST /api/buyer/tickets/[ticketId]/transfer-invite
 *
 * TM-style invite-token P2P transfer. Recipient nemusí mít účet —
 * dostane email s linkem /transfer/accept/[token] kde se přihlásí
 * nebo se zaregistruje a převede vlastnictví.
 *
 * Pro registrované recipienty doporučujeme existující POST /transfer
 * (instantní převod). Tahle route slouží pro neregistrované recipienty
 * a "one-tap mobile" UX.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import crypto from 'node:crypto';
import { z } from 'zod';


const postSchema = z.object({
  toEmail: z.string().email().max(320),
  toPhone: z.string().max(20).optional(),
  message: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  const own = await db().query<{
    id: string;
    owner_email: string;
  }>(
    `SELECT t.id, u.email AS owner_email
       FROM tickets.tickets t
       JOIN identity.users u ON u.id = t.owner_id
      WHERE t.id = $1 AND t.owner_id = $2 AND t.status = 'valid'`,
    [params.ticketId, userId],
  );

  if (own.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_OWNER_OR_INVALID' }, { status: 404 });
  }

  const pending = await db().query(
    `SELECT 1 FROM tickets.transfer_invitations
      WHERE ticket_id = $1 AND status = 'pending' AND expires_at > now()`,
    [params.ticketId],
  );
  if (pending.rows.length > 0) {
    return NextResponse.json({ error: 'PENDING_TRANSFER_EXISTS' }, { status: 409 });
  }

  if (parsed.data.toEmail.toLowerCase() === own.rows[0].owner_email.toLowerCase()) {
    return NextResponse.json({ error: 'CANT_TRANSFER_TO_SELF' }, { status: 422 });
  }

  const token = crypto.randomBytes(32).toString('base64url');

  const recipientUser = await db().query<{ id: string }>(
    `SELECT id FROM identity.users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [parsed.data.toEmail],
  );
  const toUserId = recipientUser.rows[0]?.id ?? null;

  const r = await db().query<{ id: string; expires_at: string }>(
    `INSERT INTO tickets.transfer_invitations
       (ticket_id, from_user_id, to_user_id, to_email, to_phone, invite_token, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, expires_at::text`,
    [
      params.ticketId, userId, toUserId,
      parsed.data.toEmail, parsed.data.toPhone ?? null,
      token, parsed.data.message ?? null,
    ],
  );

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000';
  const inviteUrl = `${baseUrl}/transfer/accept/${token}`;

  return NextResponse.json({
    invitationId: r.rows[0].id,
    inviteUrl,
    expiresAt: r.rows[0].expires_at,
    recipientHasAccount: toUserId !== null,
  }, { status: 201 });

  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const r = await db().query(
    `UPDATE tickets.transfer_invitations
        SET status = 'cancelled', cancelled_at = now()
      WHERE ticket_id = $1 AND from_user_id = $2 AND status = 'pending'
      RETURNING id`,
    [params.ticketId, userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NO_PENDING_TRANSFER' }, { status: 404 });
  }
  return NextResponse.json({ cancelled: true, id: r.rows[0].id });

  });
}
