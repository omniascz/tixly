/**
 * POST /api/partner/apply — public affiliate/partner self-service application
 *
 * No auth required. Creates partner record with status='pending'.
 * Platform admin reviews at /admin/partner-applications.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

const schema = z.object({
  name:          z.string().min(2).max(200),
  contactEmail:  z.string().email().max(320),
  contactPhone:  z.string().max(20).optional(),
  websiteUrl:    z.string().url().max(500).optional(),
  partnerType:   z.enum(['media', 'travel', 'ticketshop', 'agency', 'other']),
  applyNote:     z.string().max(2000).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT', issues: parsed.error.issues }, { status: 422 });
    }

    const d = parsed.data;

    // Idempotence: don't allow duplicate pending applications per email
    const existing = await db().query<{ id: string; status: string }>(
      `SELECT id, status FROM partner.partners WHERE contact_email = $1 LIMIT 1`,
      [d.contactEmail.toLowerCase()],
    );
    if (existing.rows.length > 0) {
      const s = existing.rows[0].status;
      if (s === 'pending') return NextResponse.json({ error: 'ALREADY_APPLIED', status: s }, { status: 409 });
      if (s === 'active')  return NextResponse.json({ error: 'ALREADY_PARTNER', status: s }, { status: 409 });
    }

    const r = await db().query<{ id: string }>(
      `INSERT INTO partner.partners
         (name, contact_email, contact_phone, website_url, partner_type, apply_note, status, applied_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
       RETURNING id`,
      [
        d.name,
        d.contactEmail.toLowerCase(),
        d.contactPhone ?? null,
        d.websiteUrl ?? null,
        d.partnerType,
        d.applyNote ?? null,
      ],
    );

    return NextResponse.json({ ok: true, applicationId: r.rows[0].id }, { status: 201 });
  });
}
