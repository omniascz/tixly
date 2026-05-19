/**
 * GET  /api/admin/branding — promoterova brand settings
 * PUT  /api/admin/branding — upsert
 *
 * Owner-only. Hide_powered_by je premium feature (volitelné — vyžaduje paid tier).
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

const schema = z.object({
  logoUrl: z.string().url().max(500).nullable().optional(),
  faviconUrl: z.string().url().max(500).nullable().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  emailHeaderHtml: z.string().max(5000).nullable().optional(),
  emailFooterHtml: z.string().max(5000).nullable().optional(),
  hidePoweredBy: z.boolean().optional(),
  customCss: z.string().max(20_000).nullable().optional(),
  metaTitle: z.string().max(120).nullable().optional(),
  metaDescription: z.string().max(300).nullable().optional(),
  socialFacebook: z.string().url().max(200).nullable().optional(),
  socialInstagram: z.string().url().max(200).nullable().optional(),
  socialTwitter: z.string().url().max(200).nullable().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query(
    `SELECT * FROM platform.promoter_branding WHERE promoter_id = $1`,
    [promoter.promoterId],
  );
  return NextResponse.json({ branding: r.rows[0] ?? null });
}

export async function PUT(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role !== 'owner') {
    return NextResponse.json({ error: 'OWNER_ONLY' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const d = parsed.data;
  await db().query(
    `INSERT INTO platform.promoter_branding (
       promoter_id, logo_url, favicon_url, primary_color, accent_color,
       email_header_html, email_footer_html, hide_powered_by, custom_css,
       meta_title, meta_description,
       social_facebook, social_instagram, social_twitter
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (promoter_id) DO UPDATE SET
       logo_url = EXCLUDED.logo_url,
       favicon_url = EXCLUDED.favicon_url,
       primary_color = EXCLUDED.primary_color,
       accent_color = EXCLUDED.accent_color,
       email_header_html = EXCLUDED.email_header_html,
       email_footer_html = EXCLUDED.email_footer_html,
       hide_powered_by = EXCLUDED.hide_powered_by,
       custom_css = EXCLUDED.custom_css,
       meta_title = EXCLUDED.meta_title,
       meta_description = EXCLUDED.meta_description,
       social_facebook = EXCLUDED.social_facebook,
       social_instagram = EXCLUDED.social_instagram,
       social_twitter = EXCLUDED.social_twitter,
       updated_at = NOW()`,
    [
      promoter.promoterId,
      d.logoUrl ?? null,
      d.faviconUrl ?? null,
      d.primaryColor ?? null,
      d.accentColor ?? null,
      d.emailHeaderHtml ?? null,
      d.emailFooterHtml ?? null,
      d.hidePoweredBy ?? false,
      d.customCss ?? null,
      d.metaTitle ?? null,
      d.metaDescription ?? null,
      d.socialFacebook ?? null,
      d.socialInstagram ?? null,
      d.socialTwitter ?? null,
    ],
  );
  return NextResponse.json({ ok: true });
}
