/**
 * POST /api/buyer/otp/request — vyžádej SMS OTP pro checkout validation
 *
 * Body: { phone, eventId? }
 * Returns: { ok: true, otpId, expiresAt }, dev mode navíc { devCode } pro
 *   E2E test (jen pokud TIXLY_OTP_DEV_LEAK=1).
 *
 * Mock mode (žádný TWILIO_AUTH_TOKEN env): vygeneruje code, uloží hash,
 * SMS pravděpodobně nepošle (v dev). Production: Twilio SMS Provider.
 *
 * Rate limit: 3 OTP per phone per 10 min (marketing.check_otp_rate_limit).
 *
 * CZ priority #3 (FR/UK/IT audit, ROI 7/10).
 */
import { createHash, randomInt } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';


const schema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{8,14}$/, 'phone E.164 (+420...)'),
  eventId: z.string().uuid().optional(),
});

function hashCode(code: string): string {
  // SHA-256 — OTP je krátký, 6 digit, brute force resistance via attempts limit
  return createHash('sha256').update(code).digest('hex');
}

function generateOtp(): string {
  return String(randomInt(100000, 1000000)); // 6 digits, no leading zero
}

async function sendSmsMock(phone: string, code: string): Promise<void> {
  if (process.env.TWILIO_AUTH_TOKEN) {
    // Production Twilio integration would go here:
    // await twilioClient.messages.create({ to: phone, from: TWILIO_FROM, body: ... });
    return;
  }
  // Mock — just log (server-side only).
  console.log(`[OTP MOCK] SMS → ${phone}: Tixly kód: ${code} (platí 10 min)`);
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

    // Rate limit check
    const rl = await client.query<{ ok: boolean }>(
      `SELECT marketing.check_otp_rate_limit($1) AS ok`,
      [parsed.data.phone],
    );
    if (!rl.rows[0].ok) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'RATE_LIMIT', message: 'Příliš mnoho OTP požadavků. Zkuste za pár minut.' },
        { status: 429 },
      );
    }

    const code = generateOtp();
    const codeHash = hashCode(code);

    const r = await client.query<{ id: string; expires_at: string }>(
      `INSERT INTO marketing.otp_codes (phone_e164, code_hash, event_id)
       VALUES ($1, $2, $3)
       RETURNING id, expires_at::text`,
      [parsed.data.phone, codeHash, parsed.data.eventId ?? null],
    );

    await sendSmsMock(parsed.data.phone, code);

    await client.query('COMMIT');

    const response: Record<string, unknown> = {
      ok: true,
      otpId: r.rows[0].id,
      expiresAt: r.rows[0].expires_at,
    };
    // Dev leak (jen pro E2E testy — nikdy v produkci)
    if (process.env.TIXLY_OTP_DEV_LEAK === '1') {
      response.devCode = code;
    }
    return NextResponse.json(response);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST /api/buyer/otp/request]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
