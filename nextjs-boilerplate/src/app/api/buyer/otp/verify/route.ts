/**
 * POST /api/buyer/otp/verify — ověř SMS OTP kód
 *
 * Body: { phone, code, eventId? }
 * Returns: { ok: true, otpToken } — token to be passed do /api/checkout
 *   v body.otpToken. Token = 32B base64url, TTL 30 min.
 *
 * Max 5 attempts per OTP row → potom lock.
 *
 * CZ priority #3 (FR/UK/IT audit, ROI 7/10).
 */
import { createHash, randomBytes } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';


const schema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{8,14}$/),
  code: z.string().regex(/^\d{6}$/),
  eventId: z.string().uuid().optional(),
});

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    const r = await client.query<{
      id: string;
      code_hash: string;
      attempts: number;
      verified_at: string | null;
      expires_at: string;
      event_id: string | null;
    }>(
      `SELECT id, code_hash, attempts, verified_at::text, expires_at::text, event_id
         FROM marketing.otp_codes
        WHERE phone_e164 = $1
          AND ($2::uuid IS NULL OR event_id IS NULL OR event_id = $2)
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [parsed.data.phone, parsed.data.eventId ?? null],
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'NO_OTP_FOR_PHONE', message: 'Nejdřív si nech poslat OTP.' },
        { status: 404 },
      );
    }
    const row = r.rows[0];

    if (new Date(row.expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'EXPIRED', message: 'OTP expirovalo, vyžádej si nové.' },
        { status: 410 },
      );
    }
    if (row.attempts >= 5) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'TOO_MANY_ATTEMPTS', message: 'Příliš mnoho pokusů, vyžádej si nové OTP.' },
        { status: 429 },
      );
    }

    const submittedHash = hashCode(parsed.data.code);
    if (submittedHash !== row.code_hash) {
      await client.query(
        `UPDATE marketing.otp_codes SET attempts = attempts + 1 WHERE id = $1`,
        [row.id],
      );
      await client.query('COMMIT');
      return NextResponse.json(
        { error: 'INVALID_CODE', attemptsLeft: 5 - (row.attempts + 1) },
        { status: 422 },
      );
    }

    // Generuj token použitelný v checkout
    const token = randomBytes(32)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await client.query(
      `UPDATE marketing.otp_codes
          SET verified_at = NOW(), token = $2
        WHERE id = $1`,
      [row.id, token],
    );

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      otpToken: token,
      eventId: row.event_id,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST /api/buyer/otp/verify]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
