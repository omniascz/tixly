/**
 * POST /api/buyer/phone-verification         { phone }  — pošle 6místný kód SMS
 * POST /api/buyer/phone-verification/confirm { code }   — verifikuje a nastaví phone_verified_at
 *
 * Token storage: in-memory cache + Redis fallback by produkčně, zde používáme
 * krátkou DB tabulku v `identity.verification_attempts` reused přes provider='phone'.
 *
 * Rate-limit: max 3 requesty / hodinu per user.
 */

import { randomInt } from 'crypto';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import type { Pool } from 'pg';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sendSms } from '@/lib/sms/bulkgate-mock';


const sendSchema = z.object({
  phone: z.string().min(6).max(30).regex(/^\+?[0-9 ]+$/),
});

const confirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  phone: z.string().min(6).max(30),
});

// In-process token store. V produkci: Redis s TTL.
const TOKEN_STORE = new Map<string, { code: string; phone: string; expSec: number; attempts: number }>();

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const body = (await req.json().catch(() => ({}))) as { code?: string; phone?: string };
  // Path matching — confirm má `code`, request má jen `phone`
  if (body.code) {
    return confirm(userId, body);
  }
  return sendCode(userId, body);

  });
}

async function sendCode(userId: string, body: unknown) {
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_PHONE' }, { status: 422 });
  }
  // Rate-limit
  const recent = await db().query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM identity.verification_attempts
     WHERE user_id = $1 AND provider = 'phone' AND created_at > now() - interval '1 hour'`,
    [userId],
  );
  if (Number(recent.rows[0]?.cnt ?? 0) >= 3) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', message: 'Maximálně 3 pokusy za hodinu.' },
      { status: 429 },
    );
  }

  const code = String(randomInt(100000, 999999));
  const expSec = Math.floor(Date.now() / 1000) + 600; // 10 min
  TOKEN_STORE.set(userId, {
    code,
    phone: parsed.data.phone,
    expSec,
    attempts: 0,
  });

  const r = await sendSms(
    { to: parsed.data.phone, text: `Tixly ověřovací kód: ${code} (platí 10 min)` },
    db() as unknown as Pool,
  );

  await db().query(
    `INSERT INTO identity.verification_attempts (user_id, provider, outcome)
     VALUES ($1, 'phone', 'initiated')`,
    [userId],
  );

  return NextResponse.json({
    ok: r.ok,
    expiresInSec: 600,
    note: r.provider === 'mock'
      ? `Demo mode — kód: ${code} (v produkci SMS jde přes BulkGate)`
      : null,
  });
}

async function confirm(userId: string, body: unknown) {
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_CODE' }, { status: 422 });
  }
  const rec = TOKEN_STORE.get(userId);
  if (!rec) {
    return NextResponse.json(
      { error: 'NO_PENDING', message: 'Nejdřív si nech poslat SMS kód.' },
      { status: 409 },
    );
  }
  if (rec.expSec * 1000 < Date.now()) {
    TOKEN_STORE.delete(userId);
    await db().query(
      `INSERT INTO identity.verification_attempts (user_id, provider, outcome, failure_reason)
       VALUES ($1, 'phone', 'expired', 'token expired')`,
      [userId],
    );
    return NextResponse.json({ error: 'EXPIRED' }, { status: 410 });
  }
  rec.attempts += 1;
  if (rec.attempts > 5) {
    TOKEN_STORE.delete(userId);
    return NextResponse.json({ error: 'TOO_MANY_ATTEMPTS' }, { status: 429 });
  }
  if (rec.code !== parsed.data.code || rec.phone !== parsed.data.phone) {
    await db().query(
      `INSERT INTO identity.verification_attempts (user_id, provider, outcome, failure_reason)
       VALUES ($1, 'phone', 'failed', 'mismatch')`,
      [userId],
    );
    return NextResponse.json({ error: 'MISMATCH' }, { status: 401 });
  }

  // Úspěch
  await db().query(
    `UPDATE identity.users
       SET phone = $2, phone_verified_at = now(), updated_at = now()
     WHERE id = $1`,
    [userId, rec.phone],
  );
  await db().query(
    `INSERT INTO identity.verification_attempts (user_id, provider, outcome)
     VALUES ($1, 'phone', 'success')`,
    [userId],
  );
  TOKEN_STORE.delete(userId);

  return NextResponse.json({ ok: true, verifiedAt: new Date().toISOString() });
}
