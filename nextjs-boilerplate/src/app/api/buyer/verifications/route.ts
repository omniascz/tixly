/**
 * GET  /api/buyer/verifications — list buyerových verifikací
 * POST /api/buyer/verifications — submit new (status='pending')
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';


const VERIFICATION_TYPES = ['student', 'senior', 'disability', 'youth', 'press', 'industry'] as const;

const postSchema = z.object({
  type: z.enum(VERIFICATION_TYPES),
  proofUrl: z.string().url().max(500),
  proofMetadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const r = await db().query<{
    id: string;
    type: string;
    status: string;
    verified_at: string | null;
    expires_at: string | null;
    rejection_reason: string | null;
    created_at: string;
  }>(
    `SELECT id, type, status, verified_at, expires_at, rejection_reason, created_at
     FROM identity.discount_verifications
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );
  return NextResponse.json({ verifications: r.rows });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // Pokud už je 'pending' nebo 'verified' tohoto typu, nedubluj
  const existing = await db().query<{ status: string }>(
    `SELECT status FROM identity.discount_verifications
     WHERE user_id = $1 AND type = $2 AND status IN ('pending', 'verified')`,
    [userId, parsed.data.type],
  );
  if (existing.rows.length > 0) {
    return NextResponse.json(
      { error: 'ALREADY_HAS', status: existing.rows[0].status },
      { status: 409 },
    );
  }

  const r = await db().query<{ id: string }>(
    `INSERT INTO identity.discount_verifications
       (user_id, type, proof_url, proof_metadata)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id`,
    [userId, parsed.data.type, parsed.data.proofUrl, JSON.stringify(parsed.data.proofMetadata ?? {})],
  );
  return NextResponse.json({ id: r.rows[0].id, status: 'pending' }, { status: 201 });

  });
}
