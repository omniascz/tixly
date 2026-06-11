/**
 * POST /api/auth/forgot-password
 *
 * Body: { email: string }
 *
 * Vždy vrátí 200 (anti-enumeration). Pokud user existuje, pošle email s reset linkem.
 * Token TTL: 1 hodina. Rate limit: 3/15min per IP.
 */

import { randomBytes } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sendMail } from '@/lib/email/mailer';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit/per-tenant';
import { clientIp as getClientIp } from '@/lib/security/client-ip';


const schema = z.object({
  email: z.string().email().max(320),
});

const RESET_TTL_HOURS = 1;
const BCRYPT_COST = 10;

function buildResetUrl(token: string, locale: string = 'cs'): string {
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${appUrl}/${locale}/reset-password?token=${encodeURIComponent(token)}`;
}

const EMAIL_STRINGS = {
  cs: {
    subject: 'Tixly — obnovení hesla',
    intro: 'Někdo požádal o obnovení hesla pro tvůj účet.',
    cta: 'Obnovit heslo',
    expires: 'Odkaz je platný 1 hodinu.',
    notYou: 'Pokud jsi to nebyl ty, ignoruj tento email.',
  },
  sk: {
    subject: 'Tixly — obnovenie hesla',
    intro: 'Niekto požiadal o obnovenie hesla pre tvoj účet.',
    cta: 'Obnoviť heslo',
    expires: 'Odkaz je platný 1 hodinu.',
    notYou: 'Ak si to nebol ty, ignoruj tento email.',
  },
  en: {
    subject: 'Tixly — password reset',
    intro: 'Someone requested a password reset for your account.',
    cta: 'Reset password',
    expires: 'This link is valid for 1 hour.',
    notYou: 'If this was not you, ignore this email.',
  },
};

function emailHtml(resetUrl: string, locale: 'cs' | 'sk' | 'en'): string {
  const s = EMAIL_STRINGS[locale];
  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
  <h1 style="font-size:20px;margin:0 0 16px">${s.subject}</h1>
  <p>${s.intro}</p>
  <p style="margin:24px 0">
    <a href="${resetUrl}"
       style="display:inline-block;padding:12px 24px;background:#10b981;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">
      ${s.cta}
    </a>
  </p>
  <p style="color:#666;font-size:13px">${s.expires}</p>
  <p style="color:#666;font-size:13px">${s.notYou}</p>
  <hr style="margin:24px 0;border:0;border-top:1px solid #eee">
  <p style="color:#999;font-size:11px">Tixly — vstupenky.tixly.cz</p>
</body></html>`;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  // Rate limit per IP
  const ip = getClientIp(req);
  const rl = await checkRateLimit(`forgot-password:${ip}`, { limit: 3, windowMs: 15 * 60 * 1000 });
  const rlResp = rateLimitResponse(rl, 'forgot-password');
  if (rlResp) return rlResp;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Anti-enumeration: vždy „ok" odpověď
    return NextResponse.json({ ok: true });
  }
  const email = parsed.data.email.toLowerCase().trim();

  // Lookup user
  const userRes = await db().query<{ id: string; locale: string | null; name: string | null }>(
    `SELECT id, locale, name FROM identity.users WHERE LOWER(email) = $1 LIMIT 1`,
    [email],
  );
  if (userRes.rows.length === 0) {
    // Anti-enumeration: nedávej najevo, že email neexistuje
    return NextResponse.json({ ok: true });
  }
  const user = userRes.rows[0];

  // Sliding-window cleanup expired tokens
  await db().query(
    `DELETE FROM identity.password_reset_tokens
     WHERE user_id = $1 AND (expires_at < NOW() OR used_at IS NOT NULL)`,
    [user.id],
  );

  // Generuj token (32 bytes hex = 64 chars)
  const tokenPlain = randomBytes(32).toString('hex');
  const tokenHash = await bcrypt.hash(tokenPlain, BCRYPT_COST);
  const expiresAt = new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000);

  await db().query(
    `INSERT INTO identity.password_reset_tokens
       (user_id, token_hash, expires_at, requester_ip, requester_ua)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, tokenHash, expiresAt, ip, req.headers.get('user-agent')?.slice(0, 500) ?? null],
  );

  // Pošli email
  const locale = (user.locale === 'sk' ? 'sk' : user.locale === 'en' ? 'en' : 'cs') as
    | 'cs'
    | 'sk'
    | 'en';
  const url = buildResetUrl(tokenPlain, locale);
  const html = emailHtml(url, locale);

  try {
    await sendMail({
      to: email,
      subject: EMAIL_STRINGS[locale].subject,
      html,
    });
  } catch (err) {
    console.error('[forgot-password] send failed:', err);
    // Stále vrátíme ok — neprozradíme, že email neprošel
  }

  return NextResponse.json({ ok: true });

  });
}
