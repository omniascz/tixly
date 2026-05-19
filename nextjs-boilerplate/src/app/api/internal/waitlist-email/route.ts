/**
 * POST /api/internal/waitlist-email
 *
 * Internal — odešle e-mail buyerovi, že místo bylo uvolněno.
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
  toName: z.string().nullable().optional(),
  eventTitle: z.string(),
  ticketTypeName: z.string(),
  buyUrl: z.string().url(),
  ttlMin: z.number().int().min(1).max(1440),
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
  const p = parsed.data;

  const { sendMail } = await import('@/lib/email/mailer');

  const html = `
    <h2>${escapeHtml(p.eventTitle)} — místo se uvolnilo!</h2>
    <p>${p.toName ? `Ahoj ${escapeHtml(p.toName)},` : 'Ahoj,'}</p>
    <p>Pro <strong>${escapeHtml(p.ticketTypeName)}</strong> se uvolnilo místo. Máš
       <strong>${p.ttlMin} minut</strong> na rezervaci, jinak slot půjde dalšímu z waitlistu.</p>
    <p><a href="${escapeHtml(p.buyUrl)}">Koupit lístek nyní</a></p>
    <p style="font-size:12px;color:#666">Tato pozvánka je jednorázová.</p>
  `;

  await sendMail({
    from: process.env.MAIL_FROM ?? 'noreply@tixly.cz',
    to: p.toEmail,
    subject: `Tixly: místo se uvolnilo — ${p.eventTitle}`,
    html,
    text: `Místo se uvolnilo na ${p.eventTitle} (${p.ticketTypeName}). Máš ${p.ttlMin} minut: ${p.buyUrl}`,
  });

  return NextResponse.json({ ok: true });
}
