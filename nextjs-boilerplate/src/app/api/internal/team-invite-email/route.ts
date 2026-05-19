/**
 * POST /api/internal/team-invite-email
 *
 * Body: { toEmail, promoterName, role, inviteUrl }
 *
 * Internal-only — odešle invite email přes nodemailer (Mailhog v demu).
 */

import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { escapeHtml } from '@/lib/html-escape/escape';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const schema = z.object({
  toEmail: z.string().email(),
  promoterName: z.string().min(1).max(200),
  role: z.string().min(1).max(50),
  inviteUrl: z.string().url(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }
  const { toEmail, promoterName, role, inviteUrl } = parsed.data;

  const { sendMail } = await import('@/lib/email/mailer');

  const html = `
    <h2>Pozvánka do týmu ${escapeHtml(promoterName)}</h2>
    <p>Byl/a jsi pozván/a na pozici <strong>${escapeHtml(role)}</strong>.</p>
    <p><a href="${escapeHtml(inviteUrl)}">Přijmout pozvánku</a></p>
    <p style="font-size:12px;color:#666">Odkaz vyprší za 7 dní. Pokud jsi pozvánku neočekával, ignoruj tento e-mail.</p>
  `;

  await sendMail({
    from: process.env.MAIL_FROM ?? 'noreply@tixly.cz',
    to: toEmail,
    subject: `Tixly: pozvánka do týmu ${promoterName}`,
    html,
    text: `Pozvánka do týmu ${promoterName} — role ${role}\n\n${inviteUrl}`,
  });

  return NextResponse.json({ ok: true });
}
