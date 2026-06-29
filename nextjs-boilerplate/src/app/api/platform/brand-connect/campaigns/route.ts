/**
 * GET  /api/platform/brand-connect/campaigns — list all campaigns
 * POST /api/platform/brand-connect/campaigns — create campaign
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const r = await db().query(
      `SELECT c.*, a.company_name AS advertiser_name, a.logo_url AS advertiser_logo
       FROM brands.campaigns c
       JOIN brands.advertisers a ON a.id = c.advertiser_id
       ORDER BY c.created_at DESC`,
      [],
    );
    return NextResponse.json({ campaigns: r.rows });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const b = await req.json() as {
      advertiser_id: string;
      name: string;
      tagline?: string;
      description?: string;
      logo_url?: string;
      banner_url?: string;
      cta_text?: string;
      cta_url?: string;
      target_event_categories?: string[];
      target_cities?: string[];
      target_min_capacity?: number;
      fee_per_event_czk: number;
      tixly_cut_pct?: number;
      budget_czk?: number;
      starts_at?: string;
      ends_at?: string;
    };

    if (!b.advertiser_id || !b.name?.trim() || !b.fee_per_event_czk) {
      return NextResponse.json(
        { error: 'advertiser_id + name + fee_per_event_czk required' },
        { status: 400 },
      );
    }

    const r = await db().query(
      `INSERT INTO brands.campaigns
         (advertiser_id, name, tagline, description, logo_url, banner_url, cta_text, cta_url,
          target_event_categories, target_cities, target_min_capacity,
          fee_per_event_czk, tixly_cut_pct, budget_czk, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        b.advertiser_id,
        b.name.trim(),
        b.tagline ?? null,
        b.description ?? null,
        b.logo_url ?? null,
        b.banner_url ?? null,
        b.cta_text ?? 'Zjistit více',
        b.cta_url ?? null,
        b.target_event_categories ?? null,
        b.target_cities ?? null,
        b.target_min_capacity ?? null,
        b.fee_per_event_czk,
        b.tixly_cut_pct ?? 15.00,
        b.budget_czk ?? null,
        b.starts_at ?? null,
        b.ends_at ?? null,
      ],
    );

    return NextResponse.json({ campaign: r.rows[0] }, { status: 201 });
  });
}
