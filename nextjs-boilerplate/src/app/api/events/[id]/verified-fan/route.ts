/**
 * POST /api/events/[id]/verified-fan
 *
 * Buyer pre-registration. Body: { motivation? }
 *
 * Vyžaduje x-user-id (přihlášený user). Vrací requestId + status.
 * Promotér se rozhodne (admin endpoint) → fanoušek dostane presale_code emailem.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  motivation: z.string().max(1000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'BAD_EVENT' }, { status: 422 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 422 });
  }

  // Event musí mít verified_fan_enabled
  const ev = await db().query<{ enabled: boolean }>(
    `SELECT COALESCE(verified_fan_enabled, FALSE) AS enabled
     FROM catalog.events WHERE id = $1 AND status = 'published'`,
    [params.id],
  );
  if (ev.rows.length === 0) {
    return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
  }
  if (!ev.rows[0].enabled) {
    return NextResponse.json(
      { error: 'VERIFIED_FAN_DISABLED', message: 'Tato akce nemá Verified Fan registraci.' },
      { status: 422 },
    );
  }

  // Načti user metadata pro anti-bot signals
  const user = await db().query<{ email: string; created_at: string }>(
    `SELECT email, created_at FROM identity.users WHERE id = $1`,
    [userId],
  );
  if (user.rows.length === 0) {
    return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 });
  }
  const u = user.rows[0];
  const emailDomain = u.email.split('@')[1] ?? null;
  const ageDays = Math.floor((Date.now() - new Date(u.created_at).getTime()) / 86400_000);

  try {
    const r = await db().query<{ id: string }>(
      `INSERT INTO marketing.verified_fan_requests
         (user_id, event_id, fan_motivation, email_domain, user_age_days)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [userId, params.id, parsed.data.motivation ?? null, emailDomain, ageDays],
    );
    return NextResponse.json({ ok: true, requestId: r.rows[0]?.id, status: 'pending' });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      return NextResponse.json(
        { error: 'ALREADY_APPLIED', message: 'Už jsi žádal o Verified Fan registraci.' },
        { status: 409 },
      );
    }
    throw err;
  }
}
