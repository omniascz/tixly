/**
 * POST /api/buyer/tickets/[ticketId]/bind-device
 *
 * SafeTix device binding. Při prvním otevření lístku v mobile view se
 * lístek "uzamkne" na fingerprint zařízení. Další zařízení uvidí warning
 * a musí požádat o unbind (jen po owner re-auth nebo support).
 *
 * Body: { fingerprint }
 * Response: { bound: true } | { bound: false, boundTo: '...' }
 *
 * Fingerprint je SHA256(userAgent + screen + tz + canvas hash) generovaný klientem.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import crypto from 'node:crypto';
import { z } from 'zod';


const schema = z.object({
  fingerprint: z.string().min(16).max(256),
});

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null;
  const userAgent = req.headers.get('user-agent') ?? null;

  const r = await db().query<{ id: string; device_binding_id: string | null }>(
    `SELECT id, device_binding_id FROM tickets.tickets
      WHERE id = $1 AND owner_id = $2 AND status = 'valid'`,
    [params.ticketId, userId],
  );

  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const ticket = r.rows[0];

  if (ticket.device_binding_id === null) {
    // First view — bind to this device
    await db().query(
      `UPDATE tickets.tickets
          SET device_binding_id = $1
        WHERE id = $2`,
      [parsed.data.fingerprint, params.ticketId],
    );
    await db().query(
      `INSERT INTO tickets.device_binding_log (ticket_id, device_fingerprint, action, ip_hash, user_agent, bound_by_user_id)
       VALUES ($1, $2, 'bound', $3, $4, $5)`,
      [params.ticketId, parsed.data.fingerprint, hashIp(ip), userAgent, userId],
    );
    return NextResponse.json({ bound: true, action: 'first_bind' });
  }

  if (ticket.device_binding_id === parsed.data.fingerprint) {
    return NextResponse.json({ bound: true, action: 'already_bound' });
  }

  // Different device — log attempt, return warning
  await db().query(
    `INSERT INTO tickets.device_binding_log (ticket_id, device_fingerprint, action, ip_hash, user_agent, bound_by_user_id)
     VALUES ($1, $2, 'attempted_bind_different', $3, $4, $5)`,
    [params.ticketId, parsed.data.fingerprint, hashIp(ip), userAgent, userId],
  );

  return NextResponse.json({
    bound: false,
    action: 'different_device',
    message: 'Lístek je svázán s jiným zařízením. Pro převzetí kontaktuj podporu nebo vlož původní zařízení.',
  }, { status: 409 });

  });
}

/**
 * DELETE — unbind (jen owner)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const r = await db().query(
    `UPDATE tickets.tickets
        SET device_binding_id = NULL
      WHERE id = $1 AND owner_id = $2
    RETURNING id`,
    [params.ticketId, userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  await db().query(
    `INSERT INTO tickets.device_binding_log (ticket_id, device_fingerprint, action, bound_by_user_id)
     VALUES ($1, 'unbound', 'unbound', $2)`,
    [params.ticketId, userId],
  );

  return NextResponse.json({ unbound: true });

  });
}
