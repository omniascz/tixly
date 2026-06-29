/**
 * GET  /api/platform/brand-connect/advertisers — list all advertisers
 * POST /api/platform/brand-connect/advertisers — create advertiser
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const r = await db().query(
      `SELECT a.*, COUNT(c.id)::int AS campaign_count
       FROM brands.advertisers a
       LEFT JOIN brands.campaigns c ON c.advertiser_id = a.id
       GROUP BY a.id
       ORDER BY a.created_at DESC`,
      [],
    );
    return NextResponse.json({ advertisers: r.rows });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const b = await req.json() as {
      company_name: string;
      logo_url?: string;
      website_url?: string;
      industry?: string;
      contact_email: string;
      contact_name?: string;
      internal_notes?: string;
    };

    if (!b.company_name?.trim() || !b.contact_email?.trim()) {
      return NextResponse.json({ error: 'company_name + contact_email required' }, { status: 400 });
    }

    const r = await db().query(
      `INSERT INTO brands.advertisers
         (company_name, logo_url, website_url, industry, contact_email, contact_name, internal_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        b.company_name.trim(),
        b.logo_url ?? null,
        b.website_url ?? null,
        b.industry ?? null,
        b.contact_email.trim(),
        b.contact_name ?? null,
        b.internal_notes ?? null,
      ],
    );

    return NextResponse.json({ advertiser: r.rows[0] }, { status: 201 });
  });
}
