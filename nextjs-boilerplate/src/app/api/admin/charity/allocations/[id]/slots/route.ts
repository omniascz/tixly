/**
 * GET /api/admin/charity/allocations/[id]/slots
 *
 * Vrací seznam claim_token URLs pro tuto alokaci. Promotér by neměl tahle data
 * vidět (privacy charity beneficiaries), ale platform admin pro debugging ano.
 * Pro charity flow přidáme charity-side endpoint (přístup přes API key později).
 *
 * MVP: prozatím přístupné promotérovi co vytvořil allocation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';


export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  // Ověř ownership
  const own = await db().query<{ promoter_id: string }>(
    `SELECT promoter_id FROM charity.allocations WHERE id = $1`,
    [params.id],
  );
  if (own.rows.length === 0) {
    return NextResponse.json({ error: 'ALLOCATION_NOT_FOUND' }, { status: 404 });
  }
  if (own.rows[0].promoter_id !== promoter.promoterId) {
    return NextResponse.json({ error: 'WRONG_PROMOTER' }, { status: 403 });
  }

  const r = await db().query<{
    id: string;
    claim_token: string;
    status: string;
    claimed_by_email: string | null;
    claimed_at: string | null;
    expires_at: string;
  }>(
    `SELECT id, claim_token, status, claimed_by_email, claimed_at::text, expires_at::text
       FROM charity.claim_slots
      WHERE allocation_id = $1
      ORDER BY created_at`,
    [params.id],
  );

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return NextResponse.json({
    slots: r.rows.map((s) => ({
      id: s.id,
      status: s.status,
      claimUrl: `${baseUrl}/cs/charity/claim/${s.claim_token}`,
      claimedByEmail: s.claimed_by_email,
      claimedAt: s.claimed_at,
      expiresAt: s.expires_at,
    })),
  });

  });
}
