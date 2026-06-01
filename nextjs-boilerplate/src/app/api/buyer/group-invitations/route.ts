/**
 * POST /api/buyer/group-invitations — vytvoř group invite link
 *
 * Body: { eventId, ticketTypeId?, targetSeats (2..50), message? }
 *
 * Returns: { invitationId, inviteToken, inviteUrl, expiresAt }
 *
 * CZ priority #5 (FR/UK/IT audit, ROI 6/10). Light verze — žádné payment
 * splitting, jen share link s "X z N already bought" attribution.
 */
import { randomBytes } from 'crypto';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';


const schema = z.object({
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid().optional(),
  targetSeats: z.number().int().min(2).max(50),
  message: z.string().max(500).optional(),
});

function token(): string {
  return randomBytes(24)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const inviteToken = token();
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    // Ověř že event je published
    const ev = await client.query<{ id: string }>(
      `SELECT id FROM catalog.events WHERE id = $1 AND status = 'published'`,
      [parsed.data.eventId],
    );
    if (ev.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
    }

    const r = await client.query<{ id: string; expires_at: string }>(
      `INSERT INTO orders.group_invitations
         (organizer_user_id, event_id, ticket_type_id, target_seats,
          invite_token, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, expires_at::text`,
      [
        userId,
        parsed.data.eventId,
        parsed.data.ticketTypeId ?? null,
        parsed.data.targetSeats,
        inviteToken,
        parsed.data.message ?? null,
      ],
    );
    await client.query('COMMIT');

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    return NextResponse.json({
      ok: true,
      invitationId: r.rows[0].id,
      inviteToken,
      inviteUrl: `${baseUrl}/cs/group/${inviteToken}`,
      expiresAt: r.rows[0].expires_at,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST /api/buyer/group-invitations]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
