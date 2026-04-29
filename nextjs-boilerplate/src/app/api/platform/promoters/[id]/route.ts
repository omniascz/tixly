/**
 * GET /api/platform/promoters/[id] — full detail for master admin review
 *
 * Vrátí: základní info + KYC stav + ARES data + members + recent events + KYC dokumenty.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const detailRes = await db().query<{
    id: string; name: string; slug: string | null;
    email: string; contact_email: string | null;
    status: string; locale: string;
    company_ico: string | null; company_dic: string | null; company_address: string | null;
    bank_account: string | null;
    vat_payer: boolean; vat_rate_pct: number;
    brand_logo_url: string | null; brand_color_hex: string | null; brand_tagline: string | null;
    kyc_status: string;
    kyc_submitted_at: string | null; kyc_reviewed_at: string | null;
    kyc_rejection_reason: string | null;
    ares_verified_at: string | null; ares_data: unknown;
    created_at: string; updated_at: string;
  }>(
    `SELECT id, name, slug, email, contact_email, status, locale,
            company_ico, company_dic, company_address, bank_account,
            vat_payer, vat_rate_pct,
            brand_logo_url, brand_color_hex, brand_tagline,
            kyc_status, kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason,
            ares_verified_at, ares_data,
            created_at, updated_at
       FROM platform.promoters
      WHERE id = $1`,
    [params.id],
  );
  if (!detailRes.rows.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const detail = detailRes.rows[0]!;

  const [members, events, documents] = await Promise.all([
    db().query<{ user_id: string; email: string; name: string | null; role: string; created_at: string }>(
      `SELECT pm.user_id, u.email, u.name, pm.role::text AS role, pm.created_at
         FROM platform.promoter_members pm
         JOIN identity.users u ON u.id = pm.user_id
        WHERE pm.promoter_id = $1
        ORDER BY pm.created_at`,
      [params.id],
    ),
    db().query<{ id: string; title: string; status: string; date_start: string; created_at: string }>(
      `SELECT id, title, status, date_start, created_at
         FROM catalog.events
        WHERE promoter_id = $1
        ORDER BY created_at DESC
        LIMIT 10`,
      [params.id],
    ),
    db().query<{ id: string; doc_type: string; file_url: string; uploaded_at: string }>(
      `SELECT id, doc_type, file_url, uploaded_at
         FROM platform.promoter_documents
        WHERE promoter_id = $1
        ORDER BY uploaded_at DESC`,
      [params.id],
    ).catch(() => ({ rows: [] as { id: string; doc_type: string; file_url: string; uploaded_at: string }[] })),
  ]);

  return NextResponse.json({
    promoter: detail,
    members: members.rows,
    recentEvents: events.rows,
    documents: documents.rows,
  });
}
