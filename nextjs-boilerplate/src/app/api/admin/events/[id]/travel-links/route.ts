/**
 * GET  /api/admin/events/[id]/travel-links — list cestovních odkazů
 * POST /api/admin/events/[id]/travel-links — přidat odkaz
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsActivePromoter } from '@/lib/admin-auth';

const VALID_CATS = ['hotel', 'transport', 'parking', 'rideshare', 'other'] as const;

interface TravelLinkRow {
  id: string;
  event_id: string;
  label: string;
  category: string;
  partner_name: string | null;
  url: string;
  affiliate_note: string | null;
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
      return NextResponse.json({ links: [] });
    }
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const res = await db().query<TravelLinkRow>(
      `SELECT id, event_id, label, category, partner_name, url, affiliate_note, active, display_order, created_at
       FROM catalog.event_travel_links
       WHERE event_id = $1
       ORDER BY display_order, created_at`,
      [params.id],
    );
    return NextResponse.json({ links: res.rows });
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
      label?: string;
      category?: string;
      partner_name?: string;
      url?: string;
      affiliate_note?: string;
      display_order?: number;
    };

    if (!body.label?.trim()) {
      return NextResponse.json({ error: 'Popis odkazu je povinný.' }, { status: 400 });
    }
    if (!body.url?.trim()) {
      return NextResponse.json({ error: 'URL je povinná.' }, { status: 400 });
    }

    const res = await db().query<TravelLinkRow>(
      `INSERT INTO catalog.event_travel_links
         (event_id, label, category, partner_name, url, affiliate_note, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        params.id,
        body.label.trim(),
        VALID_CATS.includes(body.category as typeof VALID_CATS[number]) ? body.category : 'other',
        body.partner_name?.trim() || null,
        body.url.trim(),
        body.affiliate_note?.trim() || null,
        body.display_order ?? 0,
      ],
    );
    return NextResponse.json({ link: res.rows[0] }, { status: 201 });
  });
}
