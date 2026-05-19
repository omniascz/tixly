/**
 * POST /api/admin/email-templates/preview
 *
 * Renderuje template s mock daty pro preview. Body:
 *   { type, subject, bodyHtml }
 *
 * Vrací plně-rendered HTML s dosazenými mock proměnnými.
 * Lze použít v admin UI iframe srcDoc nebo pro send-test-email.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

const TEMPLATE_TYPES = ['order_confirmation', 'refund', 'daily_stats'] as const;

const schema = z.object({
  type: z.enum(TEMPLATE_TYPES),
  subject: z.string().max(300),
  bodyHtml: z.string().max(50000),
  sendTestTo: z.string().email().optional(),
});

const MOCK_VARS: Record<(typeof TEMPLATE_TYPES)[number], Record<string, string>> = {
  order_confirmation: {
    eventTitle: 'Eddie & Vanessa — premiéra',
    buyerName: 'Jan Novák',
    totalAmount: '780 Kč',
    orderId: '00000000-0000-0000-0000-000000000abc',
  },
  refund: {
    orderId: '00000000-0000-0000-0000-000000000abc',
    amount: '780 Kč',
    reason: 'Na žádost zákazníka',
    eventTitle: 'Eddie & Vanessa — premiéra',
  },
  daily_stats: {
    revenue: '24 850 Kč',
    ordersCount: '17',
    tickets: '42',
    date: '14. 5. 2026',
  },
};

function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match: string, key: string) => vars[key] ?? match);
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const vars = MOCK_VARS[parsed.data.type];
  const renderedSubject = render(parsed.data.subject, vars);
  const renderedHtml = render(parsed.data.bodyHtml, vars);

  // Optional: pošli test mail
  if (parsed.data.sendTestTo) {
    try {
      const { sendMail } = await import('@/lib/email/mailer');
      await sendMail({
        to: parsed.data.sendTestTo,
        subject: `[TEST] ${renderedSubject}`,
        html: `<div style="background:#fef3c7;padding:12px;text-align:center;font-family:system-ui;font-size:12px">
          ⚠ TEST EMAIL — toto je preview šablony s mock daty
        </div>${renderedHtml}`,
      });
      return NextResponse.json({
        ok: true,
        renderedSubject,
        renderedHtml,
        testSent: true,
        testSentTo: parsed.data.sendTestTo,
      });
    } catch (err) {
      return NextResponse.json({
        ok: true,
        renderedSubject,
        renderedHtml,
        testSent: false,
        testError: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  return NextResponse.json({
    ok: true,
    renderedSubject,
    renderedHtml,
    availableVars: Object.keys(vars),
  });
}
