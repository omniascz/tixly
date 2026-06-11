/**
 * Marketing QR kampaně pro Print attribution.
 *
 * GET — list kampaní pro event s scan + conversion stats
 * POST — vytvořit novou kampaň (slug auto-generated z name pokud není zadán)
 *
 * Promotér potřebuje měřit "kolik mi dal poster v metru" — viz DACH-AUDIT-VERIFIED.md
 * sekce #5 (EVENTIM.Light Standard QR pattern).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';
import { z } from 'zod';


const createSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(3).max(40).regex(/^[a-z0-9-]+$/i).optional(),
  utmSource: z.string().max(50).optional(),
  utmMedium: z.string().max(50).optional(),
  utmCampaign: z.string().max(100).optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {

  // Cross-tenant ochrana: akce musí patřit promotérovi (RLS je v prod dormantní,
  // ownership hlídá app vrstva). Jinak by promotér A četl QR-kampaně + tržby B.
  const owns = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (owns.rowCount === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const r = await db().query<{
    id: string;
    slug: string;
    name: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    scan_count: number;
    conversion_count: number;
    conversion_total_halire: string;
    created_at: string;
  }>(
    `SELECT id, slug, name, utm_source, utm_medium, utm_campaign,
            scan_count, conversion_count, conversion_total_halire, created_at
     FROM marketing.qr_campaigns
     WHERE event_id = $1
     ORDER BY created_at DESC`,
    [params.id],
  );

  return NextResponse.json({
    campaigns: r.rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      utmSource: c.utm_source,
      utmMedium: c.utm_medium,
      utmCampaign: c.utm_campaign,
      scanCount: c.scan_count,
      conversionCount: c.conversion_count,
      conversionTotalHalire: Number(c.conversion_total_halire),
      conversionRate:
        c.scan_count > 0
          ? Math.round((c.conversion_count / c.scan_count) * 10000) / 100
          : 0,
      createdAt: c.created_at,
    })),
  });

  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {

  const userId = promoter.userId;

  // Cross-tenant ochrana: nelze zakládat kampaně na cizí akci.
  const owns = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (owns.rowCount === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const slug = parsed.data.slug?.toLowerCase() ?? slugify(parsed.data.name);
  if (slug.length < 3) {
    return NextResponse.json(
      { error: 'INVALID_SLUG', message: 'Slug musí mít min. 3 znaky (a-z, 0-9, -).' },
      { status: 422 },
    );
  }

  // Race-safe: uniqueness constraint na slug zachytí duplikáty.
  try {
    const r = await db().query<{ id: string; slug: string }>(
      `INSERT INTO marketing.qr_campaigns
         (event_id, slug, name, utm_source, utm_medium, utm_campaign, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, slug`,
      [
        params.id,
        slug,
        parsed.data.name,
        parsed.data.utmSource ?? 'print',
        parsed.data.utmMedium ?? 'qr',
        parsed.data.utmCampaign ?? null,
        userId,
      ],
    );
    return NextResponse.json({ campaign: r.rows[0] }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate.*slug|qr_campaigns_slug_key/i.test(msg)) {
      return NextResponse.json(
        { error: 'SLUG_TAKEN', message: 'Tento slug už existuje. Zvol jiný název.' },
        { status: 409 },
      );
    }
    console.error('[POST /api/admin/events/[id]/marketing-qr]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }

  });
}
