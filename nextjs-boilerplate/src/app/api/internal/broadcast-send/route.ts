/**
 * POST /api/internal/broadcast-send
 *
 * Internal — odešle hromadný e-mail recipientům. Update broadcast row stats.
 * V produkci by tu byl async queue (BullMQ / Kafka), v demu in-process loop.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Pool } from 'pg';
import { timingSafeEqual } from 'crypto';
import nodemailer from 'nodemailer';
import { escapeHtml } from '@/lib/html-escape/escape';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const schema = z.object({
  broadcastId: z.string().uuid(),
  subject: z.string(),
  body: z.string(),
  recipients: z.array(z.object({
    email: z.string().email(),
    name: z.string().nullable().optional(),
  })),
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

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false,
    ignoreTLS: true,
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      ${parsed.data.body
        .split('\n')
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')}
      <hr style="margin-top: 24px; border: none; border-top: 1px solid #e5e7eb">
      <p style="font-size: 11px; color: #666;">Tato zpráva byla odeslána pořadatelem akce.</p>
    </div>
  `;

  let sent = 0;
  let failed = 0;
  for (const r of parsed.data.recipients) {
    try {
      await transporter.sendMail({
        from: process.env.MAIL_FROM ?? 'noreply@tixly.cz',
        to: r.email,
        subject: parsed.data.subject,
        html,
        text: parsed.data.body,
      });
      sent += 1;
    } catch (err) {
      console.error('[broadcast-send]', r.email, err);
      failed += 1;
    }
  }

  await db().query(
    `UPDATE marketing.event_broadcasts
     SET sent_count = $2, failed_count = $3,
         status = CASE WHEN $3 = 0 THEN 'completed' ELSE 'failed' END,
         completed_at = NOW()
     WHERE id = $1`,
    [parsed.data.broadcastId, sent, failed],
  );

  return NextResponse.json({ ok: true, sent, failed });
}
