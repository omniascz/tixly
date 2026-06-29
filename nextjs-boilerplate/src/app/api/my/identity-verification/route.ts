/**
 * GET  /api/my/identity-verification — stav Fan ID verifikace přihlášeného uživatele
 * POST /api/my/identity-verification — podat žádost (soft-KYC)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';

const submitSchema = z.object({
  legalName: z.string().min(2).max(200),
  documentType: z.enum(['id_card', 'passport', 'driving_licence']).default('id_card'),
  documentNumber: z.string().max(40).optional(),
  documentFrontUrl: z.string().url().max(500).optional(),
  selfieUrl: z.string().url().max(500).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const r = await db().query<{
      id: string; legal_name: string; document_type: string;
      status: string; submitted_at: string; reviewed_at: string | null;
      reviewer_notes: string | null;
    }>(
      `SELECT id, legal_name, document_type, status, submitted_at, reviewed_at, reviewer_notes
         FROM orders.identity_verifications
        WHERE user_id = $1
        ORDER BY submitted_at DESC LIMIT 1`,
      [userId],
    );

    // Fan ID flag on user
    const u = await db().query<{ fan_id_verified: boolean }>(
      `SELECT fan_id_verified FROM identity.users WHERE id = $1`,
      [userId],
    );

    return NextResponse.json({
      fanIdVerified: u.rows[0]?.fan_id_verified ?? false,
      latest: r.rows[0] ?? null,
    });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    }

    // Nelze podat druhou žádost, pokud je jedna pending nebo approved
    const existing = await db().query<{ status: string }>(
      `SELECT status FROM orders.identity_verifications
        WHERE user_id = $1 AND status IN ('pending', 'approved')
        LIMIT 1`,
      [userId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      const s = existing.rows[0].status;
      return NextResponse.json(
        { error: s === 'approved' ? 'ALREADY_VERIFIED' : 'PENDING_REVIEW' },
        { status: 409 },
      );
    }

    const r = await db().query<{ id: string }>(
      `INSERT INTO orders.identity_verifications
         (user_id, legal_name, document_type, document_number, document_front_url, selfie_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        userId,
        parsed.data.legalName,
        parsed.data.documentType,
        parsed.data.documentNumber ?? null,
        parsed.data.documentFrontUrl ?? null,
        parsed.data.selfieUrl ?? null,
      ],
    );

    return NextResponse.json({ ok: true, id: r.rows[0].id, status: 'pending' }, { status: 201 });
  });
}
