import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

interface SoldPassRow {
  id: string;
  product_id: string;
  pass_token: string;
  holder_email: string;
  holder_name: string | null;
  uses_remaining: number;
  valid_until: string;
  status: string;
  created_at: string;
  product_title: string;
  total_uses: number;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const r = await db().query<SoldPassRow>(
      `SELECT sp.id, sp.product_id, sp.pass_token, sp.holder_email, sp.holder_name,
              sp.uses_remaining, sp.valid_until::text, sp.status, sp.created_at::text,
              spp.title AS product_title, spp.total_uses
       FROM orders.season_passes sp
       JOIN catalog.season_pass_products spp ON spp.id = sp.product_id
       WHERE spp.promoter_id = $1
       ORDER BY sp.created_at DESC
       LIMIT 500`,
      [promoter.promoterId],
    );
    return NextResponse.json({
      passes: r.rows.map((p) => ({
        id: p.id,
        productId: p.product_id,
        passToken: p.pass_token,
        holderEmail: p.holder_email,
        holderName: p.holder_name,
        usesRemaining: p.uses_remaining,
        totalUses: p.total_uses,
        validUntil: p.valid_until,
        status: p.status,
        productTitle: p.product_title,
        createdAt: p.created_at,
      })),
    });
  });
}
