/**
 * POST /api/auth/send-verification-email
 *
 * Pošle uživateli ověřovací link s HMAC tokenem. Volá se:
 *   - Po registraci (signup)
 *   - Z `/cs/profile` jako „Poslat ověřovací email znovu"
 *
 * Auth: x-user-id (musíš být přihlášený). Pokud už je email ověřený, vrátí 200 no-op.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { issueEmailVerificationToken } from '@/lib/email-verification/token';
import { escapeHtml } from '@/lib/html-escape/escape';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function POST(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<{
    id: string;
    email: string;
    name: string | null;
    email_verified_at: string | null;
  }>(
    `SELECT id, email, name, email_verified_at FROM identity.users WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const u = r.rows[0];
  if (u.email_verified_at) {
    return NextResponse.json({ alreadyVerified: true });
  }

  const token = issueEmailVerificationToken(u.id);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const link = `${baseUrl}/cs/verify-email?token=${encodeURIComponent(token)}`;

  const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
  <h1 style="color:#10b981">Ověř svůj e-mail</h1>
  <p>Ahoj ${escapeHtml(u.name ?? '')},</p>
  <p>klikni na odkaz níže a potvrď, že tato adresa patří tobě:</p>
  <p style="margin:24px 0">
    <a href="${link}" style="display:inline-block;background:#10b981;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
      Ověřit e-mail
    </a>
  </p>
  <p style="color:#666;font-size:12px">
    Odkaz platí 3 dny. Pokud jsi se neregistroval/a, ignoruj tento e-mail.<br/>
    Nefunkční tlačítko? Zkopíruj URL ručně:<br/>
    <code style="font-size:10px">${link}</code>
  </p>
</body></html>`;

  try {
    const { sendMail } = await import('@/lib/email/mailer');
    await sendMail({
      to: u.email,
      subject: 'Ověření e-mailu — Tixly',
      html,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[send-verification-email]', e);
    return NextResponse.json(
      { error: 'SEND_FAILED', message: 'E-mail se nepodařilo odeslat.' },
      { status: 500 },
    );
  }
}
