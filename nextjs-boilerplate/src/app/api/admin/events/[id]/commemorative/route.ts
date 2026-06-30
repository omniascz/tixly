import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

interface TemplateRow {
  event_id: string;
  quote: string | null;
  theme_color: string;
  accent_color: string;
  custom_message: string | null;
  is_active: boolean;
  updated_at: string;
  created_at: string;
}

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return r.rows.length > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;

    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const r = await db().query<TemplateRow>(
      `SELECT event_id, quote, theme_color, accent_color, custom_message, is_active, created_at AS updated_at, created_at
         FROM catalog.commemorative_templates
        WHERE event_id = $1`,
      [eventId],
    );

    return NextResponse.json({ template: r.rows[0] ?? null });
  });
}

const postSchema = z.object({
  quote: z.string().max(500).nullable().optional(),
  themeColor: z.string().max(20).optional(),
  accentColor: z.string().max(20).optional(),
  customMessage: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;

    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }
    const d = parsed.data;

    const r = await db().query<TemplateRow>(
      `INSERT INTO catalog.commemorative_templates
         (event_id, quote, theme_color, accent_color, custom_message, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_id) DO UPDATE SET
         quote          = COALESCE(EXCLUDED.quote, catalog.commemorative_templates.quote),
         theme_color    = COALESCE(EXCLUDED.theme_color, catalog.commemorative_templates.theme_color),
         accent_color   = COALESCE(EXCLUDED.accent_color, catalog.commemorative_templates.accent_color),
         custom_message = COALESCE(EXCLUDED.custom_message, catalog.commemorative_templates.custom_message),
         is_active      = COALESCE(EXCLUDED.is_active, catalog.commemorative_templates.is_active)
       RETURNING event_id, quote, theme_color, accent_color, custom_message, is_active, created_at AS updated_at, created_at`,
      [
        eventId,
        d.quote ?? null,
        d.themeColor ?? '#1a1a2e',
        d.accentColor ?? '#e2b96f',
        d.customMessage ?? null,
        d.isActive ?? false,
      ],
    );

    return NextResponse.json({ template: r.rows[0] });
  });
}
