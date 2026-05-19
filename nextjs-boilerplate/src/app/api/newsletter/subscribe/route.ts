/**
 * POST /api/newsletter/subscribe
 *
 * Body: { email, name?, promoterId? (volitelné — platform-level newsletter pokud null), source? }
 *
 * Generuje confirm_token + pošle confirm email (double opt-in).
 * Po kliknutí na confirm link → status='confirmed'.
 */

import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { escapeHtml } from '@/lib/html-escape/escape';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(120).optional(),
  promoterId: z.string().uuid().optional(),
  source: z.string().max(100).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  // Idempotent — pokud už pending nebo confirmed, vrátíme bez akce
  const existing = await db().query<{ id: string; status: string }>(
    `SELECT id, status FROM marketing.newsletter_subscribers
     WHERE LOWER(email) = LOWER($1)
       AND ($2::uuid IS NULL OR promoter_id = $2)
       AND status IN ('pending', 'confirmed')`,
    [parsed.data.email, parsed.data.promoterId ?? null],
  );
  if (existing.rows.length > 0) {
    return NextResponse.json({ ok: true, status: existing.rows[0].status, existing: true });
  }

  const token = randomBytes(24).toString('base64url');
  const r = await db().query<{ id: string }>(
    `INSERT INTO marketing.newsletter_subscribers
       (promoter_id, email, name, confirm_token, source, ip)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      parsed.data.promoterId ?? null,
      parsed.data.email.toLowerCase(),
      parsed.data.name ?? null,
      token,
      parsed.data.source ?? null,
      ip,
    ],
  );

  const confirmUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/newsletter/confirm?token=${token}`;
  const { sendMail } = await import('@/lib/email/mailer');
  await sendMail({
    from: process.env.MAIL_FROM ?? 'noreply@tixly.cz',
    to: parsed.data.email,
    subject: 'Tixly: potvrď přihlášení k newsletteru',
    html: `
        <h2>Potvrď přihlášení</h2>
        <p>${parsed.data.name ? `Ahoj ${escapeHtml(parsed.data.name)},` : 'Ahoj,'}</p>
        <p>Klikni na odkaz pro potvrzení e-mailu <strong>${escapeHtml(parsed.data.email)}</strong>:</p>
        <p><a href="${escapeHtml(confirmUrl)}">Potvrdit přihlášení</a></p>
        <p style="font-size:12px;color:#666">Pokud sis nevyžádal/a tento email, ignoruj jej.</p>
      `,
    text: `Potvrď přihlášení: ${confirmUrl}`,
  }).catch((err) => console.error('[newsletter confirm email]', err));

  return NextResponse.json({ ok: true, id: r.rows[0].id, status: 'pending' }, { status: 201 });
}
