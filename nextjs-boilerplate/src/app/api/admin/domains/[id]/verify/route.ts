/**
 * POST /api/admin/domains/[id]/verify
 *
 * Server lookup TXT record na _tixly-verify.{domain}, ověří že obsahuje verification_token.
 * V production: Node DNS lookup; v demu: vrátí success pokud query string ?force=true.
 */

import { resolveTxt } from 'dns/promises';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterOwner } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';


export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoterOwner(req, async (promoter) => {
  const force = req.nextUrl.searchParams.get('force') === 'true';

  const r = await db().query<{
    id: string;
    domain: string;
    verification_token: string;
    verified_at: string | null;
  }>(
    `SELECT id, domain, verification_token, verified_at
     FROM platform.promoter_domains
     WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (r.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const row = r.rows[0];
  if (row.verified_at) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  let verified = false;
  let foundRecords: string[] = [];

  if (force && process.env.NODE_ENV !== 'production') {
    verified = true;
  } else {
    try {
      const records = await resolveTxt(`_tixly-verify.${row.domain}`);
      foundRecords = records.flat();
      verified = foundRecords.some((r) => r.includes(row.verification_token));
    } catch (err) {
      return NextResponse.json(
        {
          error: 'DNS_LOOKUP_FAILED',
          message: (err as Error).message,
          expectedRecord: `_tixly-verify.${row.domain} TXT "${row.verification_token}"`,
        },
        { status: 422 },
      );
    }
  }

  if (!verified) {
    return NextResponse.json(
      {
        error: 'VERIFICATION_FAILED',
        message: 'TXT record nenalezen.',
        expectedRecord: `_tixly-verify.${row.domain} TXT "${row.verification_token}"`,
        foundRecords,
      },
      { status: 422 },
    );
  }

  // Pokud je to první ověřená doména, set primary
  const primaryCheck = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM platform.promoter_domains
     WHERE promoter_id = $1 AND verified_at IS NOT NULL`,
    [promoter.promoterId],
  );
  const isFirst = Number(primaryCheck.rows[0]?.count ?? 0) === 0;

  await db().query(
    `UPDATE platform.promoter_domains
     SET verified_at = NOW(), primary_domain = $2
     WHERE id = $1`,
    [row.id, isFirst],
  );
  return NextResponse.json({ ok: true, primary: isFirst });

  });
}
