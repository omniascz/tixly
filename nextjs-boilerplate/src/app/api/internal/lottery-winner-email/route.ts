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
  quantity: z.number().int().min(1),
  redeemUrl: z.string().url(),
  deadlineHours: z.number().int().min(1),
});

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  const p = parsed.data;

  const { sendMail } = await import('@/lib/email/mailer');

  const html = `
    <h2>🎉 ${escapeHtml(p.eventTitle)} — vyhrál/a jsi v losování!</h2>
    <p>${p.toName ? `Ahoj ${escapeHtml(p.toName)},` : 'Ahoj,'}</p>
    <p>Bylo ti přiděleno <strong>${p.quantity}</strong> vstupenek. Potvrdit a zaplatit musíš
       během <strong>${p.deadlineHours} hodin</strong>.</p>
    <p><a href="${escapeHtml(p.redeemUrl)}">Potvrdit a zaplatit</a></p>
    <p style="font-size:12px;color:#666">Pokud nepotvrdíš, slot půjde dalšímu losovanému.</p>
  `;

  await sendMail({
    from: process.env.MAIL_FROM ?? 'noreply@tixly.cz',
    to: p.toEmail,
    subject: `Tixly: vyhrál/a jsi v losování — ${p.eventTitle}`,
    html,
    text: `Vyhrál/a jsi ${p.quantity} vstupenek. Potvrď do ${p.deadlineHours}h: ${p.redeemUrl}`,
  });

  return NextResponse.json({ ok: true });
}
