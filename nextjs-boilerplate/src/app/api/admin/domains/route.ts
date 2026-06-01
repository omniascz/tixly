/**
 * GET  /api/admin/domains — list promoter domains
 * POST /api/admin/domains — register new domain (status pending verification)
 *
 * DNS verification flow:
 *   1. Promoter requests domain
 *   2. Server vrátí TXT record value (`tixly-verify=<random>`)
 *   3. Promoter přidá TXT record do DNS
 *   4. Promoter klikne „Verify" → server check via DNS lookup → mark verified_at
 */

import { randomBytes } from 'crypto';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsPromoterOwner } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';


const postSchema = z.object({
  domain: z
    .string()
    .min(4)
    .max(200)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Neplatná doména'),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const r = await db().query<{
    id: string;
    domain: string;
    verified_at: string | null;
    verification_token: string;
    primary_domain: boolean;
    created_at: string;
  }>(
    `SELECT id, domain, verified_at, verification_token, primary_domain, created_at
     FROM platform.promoter_domains
     WHERE promoter_id = $1
     ORDER BY primary_domain DESC, created_at ASC`,
    [promoter.promoterId],
  );
  return NextResponse.json({ domains: r.rows });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoterOwner(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const domain = parsed.data.domain.toLowerCase();
  const token = `tixly-verify=${randomBytes(16).toString('hex')}`;
  try {
    const r = await db().query<{ id: string }>(
      `INSERT INTO platform.promoter_domains (promoter_id, domain, verification_token)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [promoter.promoterId, domain, token],
    );
    return NextResponse.json(
      {
        id: r.rows[0].id,
        domain,
        verificationToken: token,
        instructions: `Přidej do DNS TXT record na _tixly-verify.${domain} s hodnotou ${token}, pak klikni Verify.`,
      },
      { status: 201 },
    );
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'DOMAIN_TAKEN' }, { status: 409 });
    }
    throw err;
  }

  });
}
