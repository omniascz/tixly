/**
 * GET  /api/admin/events/[id]/sponsors — list sponzorů
 * POST /api/admin/events/[id]/sponsors — přidat sponzora
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsActivePromoter } from '@/lib/admin-auth';

interface SponsorRow {
  id: string;
  event_id: string;
  name: string;
  logo_url: string | null;
  click_url: string | null;
  tagline: string | null;
  placement: string;
  active: boolean;
  display_order: number;
  created_at: string;
}

async function ensureOwnership(eventId: string, promoterId: string): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
    [eventId, promoterId],
  );
  return r.rows.length > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ sponsors: [] });
    }
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const res = await db().query<SponsorRow>(
      `SELECT id, event_id, name, logo_url, click_url, tagline, placement, active, display_order, created_at
       FROM catalog.event_sponsors
       WHERE event_id = $1
       ORDER BY display_order, created_at`,
      [params.id],
    );
    return NextResponse.json({ sponsors: res.rows });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = (await req.json()) as {
      name?: string;
      logo_url?: string;
      click_url?: string;
      tagline?: string;
      placement?: string;
      display_order?: number;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Název sponzora je povinný.' }, { status: 400 });
    }

    const VALID_PLACEMENTS = ['confirmation', 'event_page', 'ticket_email', 'all'];
    const res = await db().query<SponsorRow>(
      `INSERT INTO catalog.event_sponsors
         (event_id, name, logo_url, click_url, tagline, placement, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        params.id,
        body.name.trim(),
        body.logo_url?.trim() || null,
        body.click_url?.trim() || null,
        body.tagline?.trim() || null,
        VALID_PLACEMENTS.includes(body.placement ?? '') ? body.placement : 'all',
        body.display_order ?? 0,
      ],
    );
    return NextResponse.json({ sponsor: res.rows[0] }, { status: 201 });
  });
}
