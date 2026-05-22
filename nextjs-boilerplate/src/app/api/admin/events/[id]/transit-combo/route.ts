/**
 * GET/PATCH /api/admin/events/[id]/transit-combo
 *
 * GET: vrátí current transit_combo config pro event (nebo null) + list partnerů
 * PATCH: enable/update — promotér vybere partner, zones, validity window
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

const patchSchema = z.object({
  partnerSlug: z.string().min(2).max(40),
  zones: z.array(z.string().min(1).max(10)).min(1).max(20),
  validFromOffsetHours: z.number().int().min(-24).max(48).optional(),
  validUntilOffsetHours: z.number().int().min(1).max(72).optional(),
  partnerFeeHalire: z.number().int().min(0).max(10_000).optional(),
  enabled: z.boolean().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [comboRes, partnersRes] = await Promise.all([
    db().query<{
      event_id: string;
      partner_id: string;
      partner_slug: string;
      partner_name: string;
      zones: string[];
      valid_from_offset_hours: number;
      valid_until_offset_hours: number;
      partner_fee_halire: number;
      enabled: boolean;
    }>(
      `SELECT etc.event_id, etc.partner_id, tp.slug AS partner_slug,
              tp.name AS partner_name,
              etc.zones, etc.valid_from_offset_hours, etc.valid_until_offset_hours,
              etc.partner_fee_halire, etc.enabled
       FROM catalog.event_transit_combo etc
       JOIN marketing.transit_partners tp ON tp.id = etc.partner_id
       WHERE etc.event_id = $1`,
      [params.id],
    ),
    db().query<{
      id: string;
      slug: string;
      name: string;
      city: string | null;
      available_zones: string[];
    }>(
      `SELECT id, slug, name, city, available_zones
       FROM marketing.transit_partners
       WHERE is_active = true
       ORDER BY name`,
    ),
  ]);

  const combo = comboRes.rows[0] ?? null;
  return NextResponse.json({
    combo: combo
      ? {
          partnerSlug: combo.partner_slug,
          partnerName: combo.partner_name,
          zones: combo.zones,
          validFromOffsetHours: combo.valid_from_offset_hours,
          validUntilOffsetHours: combo.valid_until_offset_hours,
          partnerFeeHalire: combo.partner_fee_halire,
          enabled: combo.enabled,
        }
      : null,
    partners: partnersRes.rows.map((p) => ({
      slug: p.slug,
      name: p.name,
      city: p.city,
      availableZones: p.available_zones,
    })),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify event ownership
  const evRes = await db().query<{ promoter_id: string }>(
    `SELECT promoter_id FROM catalog.events WHERE id = $1`,
    [params.id],
  );
  if (evRes.rows.length === 0) {
    return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
  }
  if (evRes.rows[0].promoter_id !== promoter.promoterId) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // Resolve partner
  const partnerRes = await db().query<{ id: string; available_zones: string[] }>(
    `SELECT id, available_zones FROM marketing.transit_partners
     WHERE slug = $1 AND is_active = true`,
    [parsed.data.partnerSlug],
  );
  if (partnerRes.rows.length === 0) {
    return NextResponse.json(
      { error: 'PARTNER_NOT_FOUND', message: `Transit partner '${parsed.data.partnerSlug}' není dostupný.` },
      { status: 404 },
    );
  }
  const partner = partnerRes.rows[0];

  // Validate zones jsou subset partnerových
  const invalid = parsed.data.zones.filter((z) => !partner.available_zones.includes(z));
  if (invalid.length > 0) {
    return NextResponse.json(
      {
        error: 'INVALID_ZONES',
        message: `Zóny ${invalid.join(', ')} nejsou v partnerově nabídce.`,
        availableZones: partner.available_zones,
      },
      { status: 422 },
    );
  }

  await db().query(
    `INSERT INTO catalog.event_transit_combo
       (event_id, partner_id, zones, valid_from_offset_hours,
        valid_until_offset_hours, partner_fee_halire, enabled)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
     ON CONFLICT (event_id) DO UPDATE
       SET partner_id = EXCLUDED.partner_id,
           zones = EXCLUDED.zones,
           valid_from_offset_hours = EXCLUDED.valid_from_offset_hours,
           valid_until_offset_hours = EXCLUDED.valid_until_offset_hours,
           partner_fee_halire = EXCLUDED.partner_fee_halire,
           enabled = EXCLUDED.enabled,
           updated_at = now()`,
    [
      params.id,
      partner.id,
      JSON.stringify(parsed.data.zones),
      parsed.data.validFromOffsetHours ?? 0,
      parsed.data.validUntilOffsetHours ?? 30,
      parsed.data.partnerFeeHalire ?? 0,
      parsed.data.enabled ?? true,
    ],
  );

  return NextResponse.json({ ok: true });
}
