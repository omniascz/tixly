/**
 * POST /api/auth/magic-link/request
 *
 * Body: { email: string; locale?: 'cs'|'sk'|'en'; next?: string }
 *
 * Vždy vrátí 200 (anti-enumeration). Pokud user existuje, pošle 15minutový
 * přihlašovací odkaz. Token uložen jako SHA-256 hash (O(1) lookup).
 * Rate limit: 3 požadavky / 15 min per IP.
 */

import { randomBytes, createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { sendMail } from '@/lib/email/mailer';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit/per-tenant';
import { clientIp } from '@/lib/security/client-ip';

export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().email().max(320),
  locale: z.enum(['cs', 'sk', 'en']).optional().default('cs'),
  next: z.string().max(500).optional(),
});

const TTL_MINUTES = 15;

function sha256hex(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

function buildMagicUrl(token: string, locale: string, next?: string): string {
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const params = new URLSearchParams({ token, locale });
  if (next) params.set('next', next);
  return `${appUrl}/api/auth/magic-link/verify?${params.toString()}`;
}

type Locale = 'cs' | 'sk' | 'en';

const STRINGS: Record<Locale, { subject: string; heading: string; intro: string; cta: string; expires: string; notYou: string }> = {
  cs: {
    subject: 'Tixly — přihlašovací odkaz',
    heading: 'Přihlásit se do Tixly',
    intro: 'Klikni na tlačítko níže a okamžitě se přihlásíš. Žádné heslo.',
    cta: 'Přihlásit se',
    expires: `Odkaz je platný ${TTL_MINUTES} minut a lze jej použít pouze jednou.`,
    notYou: 'Pokud jsi tento email nepožadoval/a, ignoruj ho.',
  },
  sk: {
    subject: 'Tixly — prihlasovací odkaz',
    heading: 'Prihlásiť sa do Tixly',
    intro: 'Klikni na tlačidlo nižšie a ihneď sa prihlás. Žiadne heslo.',
    cta: 'Prihlásiť sa',
    expires: `Odkaz je platný ${TTL_MINUTES} minút a možno ho použiť iba raz.`,
    notYou: 'Ak si tento email nepožiadal/a, ignoruj ho.',
  },
  en: {
    subject: 'Tixly — sign-in link',
    heading: 'Sign in to Tixly',
    intro: 'Click the button below to sign in instantly. No password needed.',
    cta: 'Sign in',
    expires: `This link is valid for ${TTL_MINUTES} minutes and can only be used once.`,
    notYou: "If you didn't request this, you can safely ignore it.",
  },
};

function emailHtml(magicUrl: string, locale: Locale, name: string | null): string {
  const s = STRINGS[locale];
  const greeting = name ? `Ahoj${locale === 'en' ? '' : ''} ${name.split(' ')[0]},` : '';
  return `<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:system-ui,-apple-system,sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#10b981,#059669);padding:28px 32px">
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style="display:block">
        <rect width="36" height="36" rx="9" fill="rgba(255,255,255,.2)"/>
        <path d="M10 18l6 6 10-11" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <h1 style="color:#fff;font-size:20px;font-weight:700;margin:14px 0 0">${s.heading}</h1>
    </div>
    <div style="padding:32px">
      ${greeting ? `<p style="margin:0 0 12px;font-size:15px;color:#374151">${greeting}</p>` : ''}
      <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.6">${s.intro}</p>
      <a href="${magicUrl}"
         style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:16px">
        ${s.cta} →
      </a>
      <hr style="margin:28px 0;border:0;border-top:1px solid #f0f0f0">
      <p style="margin:0 0 6px;font-size:12px;color:#9ca3af">${s.expires}</p>
      <p style="margin:0;font-size:12px;color:#9ca3af">${s.notYou}</p>
    </div>
    <div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #f0f0f0">
      <p style="margin:0;font-size:11px;color:#d1d5db">Tixly s.r.o. · app.tixly.cz</p>
    </div>
  </div>
</body>
</html>`;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    // Rate limit per IP
    const ip = clientIp(req);
    const rl = await checkRateLimit(`magic-link:${ip}`, { limit: 3, windowMs: 15 * 60_000 });
    const rlResp = rateLimitResponse(rl, 'magic-link');
    if (rlResp) return rlResp;

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: true }); // anti-enumeration
    }
    const { email, locale, next } = parsed.data;
    const emailLower = email.toLowerCase().trim();

    // Lookup user
    const userRes = await db().query<{ id: string; name: string | null }>(
      `SELECT id, name FROM identity.users
       WHERE LOWER(email) = $1 AND deleted_at IS NULL AND anonymized_at IS NULL
       LIMIT 1`,
      [emailLower],
    );
    if (userRes.rows.length === 0) {
      return NextResponse.json({ ok: true }); // anti-enumeration
    }
    const user = userRes.rows[0];

    // Cleanup starých/použitých tokenů tohoto uživatele
    await db().query(
      `DELETE FROM identity.magic_link_tokens
       WHERE user_id = $1 AND (expires_at < NOW() OR used_at IS NOT NULL)`,
      [user.id],
    );

    // Limit: max 2 platné tokeny zároveň (ochrana proti spamu)
    const existing = await db().query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM identity.magic_link_tokens
       WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [user.id],
    );
    if (parseInt(existing.rows[0]?.count ?? '0', 10) >= 2) {
      return NextResponse.json({ ok: true }); // tiché zamítnutí, existující token stačí
    }

    // Generuj token (32 bytes hex = 64 chars), ulož jako SHA-256 hash
    const tokenPlain = randomBytes(32).toString('hex');
    const tokenHash = sha256hex(tokenPlain);
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000);

    await db().query(
      `INSERT INTO identity.magic_link_tokens
         (user_id, token_hash, expires_at, requester_ip, requester_ua)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, tokenHash, expiresAt, ip, req.headers.get('user-agent')?.slice(0, 500) ?? null],
    );

    // Pošli email
    const magicUrl = buildMagicUrl(tokenPlain, locale, next);
    try {
      await sendMail({
        to: emailLower,
        subject: STRINGS[locale].subject,
        html: emailHtml(magicUrl, locale, user.name),
      });
    } catch (err) {
      console.error('[magic-link] send failed:', err);
      // Stále vrátíme ok — neprozradíme chybu
    }

    return NextResponse.json({ ok: true });
  });
}
