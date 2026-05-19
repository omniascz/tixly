/**
 * GET /api/admin/email-templates — list všech 3 typů (s defaults pokud chybí)
 * POST /api/admin/email-templates — upsert
 *
 * Body POST: { type: 'order_confirmation'|'refund'|'daily_stats', subject, bodyHtml }
 *
 * Render engine podporuje {{variable}} substituci pro proměnné per-typ:
 *   order_confirmation: {{eventTitle}} {{buyerName}} {{totalAmount}} {{orderId}}
 *   refund: {{orderId}} {{amount}} {{reason}} {{eventTitle}}
 *   daily_stats: {{revenue}} {{ordersCount}} {{tickets}} {{date}}
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const TEMPLATE_TYPES = ['order_confirmation', 'refund', 'daily_stats'] as const;

const DEFAULTS: Record<(typeof TEMPLATE_TYPES)[number], { subject: string; bodyHtml: string }> = {
  order_confirmation: {
    subject: 'Tixly — vstupenky na {{eventTitle}}',
    bodyHtml: '<h1>Děkujeme za nákup, {{buyerName}}!</h1><p>Tvá objednávka {{orderId}} byla zaplacena. Celkem {{totalAmount}}.</p><p>Vstupenky najdeš v příloze.</p>',
  },
  refund: {
    subject: 'Tixly — refund objednávky {{orderId}}',
    bodyHtml: '<h1>Refund zpracován</h1><p>Vaše objednávka {{orderId}} ({{eventTitle}}) byla vrácena. Částka: {{amount}}. Důvod: {{reason}}.</p>',
  },
  daily_stats: {
    subject: 'Tixly — denní přehled {{date}}',
    bodyHtml: '<h1>Denní přehled · {{date}}</h1><ul><li>Tržby: {{revenue}}</li><li>Objednávek: {{ordersCount}}</li><li>Lístků: {{tickets}}</li></ul>',
  },
};

interface TemplateRow {
  id: string;
  template_type: string;
  subject: string;
  body_html: string;
  active: boolean;
  updated_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<TemplateRow>(
    `SELECT id, template_type, subject, body_html, active, updated_at
     FROM platform.email_templates
     WHERE promoter_id = $1`,
    [promoter.promoterId],
  );

  // Vrať vždy všechny 3 typy: existující customizaci + default fallback
  const byType = new Map(r.rows.map((row) => [row.template_type, row]));
  const result = TEMPLATE_TYPES.map((type) => {
    const existing = byType.get(type);
    if (existing) {
      return {
        type,
        custom: true,
        subject: existing.subject,
        bodyHtml: existing.body_html,
        active: existing.active,
        updatedAt: existing.updated_at,
      };
    }
    return {
      type,
      custom: false,
      subject: DEFAULTS[type].subject,
      bodyHtml: DEFAULTS[type].bodyHtml,
      active: true,
      updatedAt: null,
    };
  });
  return NextResponse.json({ templates: result });
}

const upsertSchema = z.object({
  type: z.enum(TEMPLATE_TYPES),
  subject: z.string().min(1).max(200),
  bodyHtml: z.string().min(1).max(50_000),
  active: z.boolean().default(true),
});

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;
  const r = await db().query<{ id: string }>(
    `INSERT INTO platform.email_templates
       (promoter_id, template_type, subject, body_html, active)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (promoter_id, template_type) DO UPDATE SET
       subject = EXCLUDED.subject,
       body_html = EXCLUDED.body_html,
       active = EXCLUDED.active,
       updated_at = NOW()
     RETURNING id`,
    [promoter.promoterId, input.type, input.subject, input.bodyHtml, input.active],
  );
  return NextResponse.json({ id: r.rows[0].id, type: input.type });
}
