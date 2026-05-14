/**
 * PATCH /api/admin/events/[id]/accreditation/[reqId]
 * Body: { action: 'approve' | 'reject' | 'cancel', rejectionReason? }
 *
 * Po approve odešle mail aplikantovi (fire-and-forget).
 * Vystavení comp ticketu = další task (vyžaduje vybrat ticket_type kind='accreditation').
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const patchSchema = z.object({
  action: z.enum(['approve', 'reject', 'cancel']),
  rejectionReason: z.string().max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; reqId: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(params.id) || !/^[0-9a-f-]{36}$/i.test(params.reqId)) {
    return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // Ownership: promoter vlastní event
  const own = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events
     WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (Number(own.rows[0]?.count ?? 0) === 0) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const newStatus = parsed.data.action === 'approve' ? 'approved'
    : parsed.data.action === 'reject' ? 'rejected'
    : 'cancelled';

  const r = await db().query<{
    applicant_email: string;
    applicant_name: string;
    category: string;
    event_title: string;
  }>(
    `UPDATE marketing.accreditation_requests ar
     SET status = $3, reviewer_user_id = $4, reviewed_at = NOW(),
         rejection_reason = $5, updated_at = NOW()
     FROM catalog.events e
     WHERE ar.id = $1 AND ar.event_id = $2 AND e.id = ar.event_id AND ar.status = 'pending'
     RETURNING ar.applicant_email, ar.applicant_name, ar.category, e.title AS event_title`,
    [
      params.reqId,
      params.id,
      newStatus,
      promoter.userId,
      parsed.data.rejectionReason ?? null,
    ],
  );

  if (r.rows.length === 0) {
    return NextResponse.json(
      { error: 'NOT_FOUND_OR_NOT_PENDING' },
      { status: 404 },
    );
  }
  const row = r.rows[0]!;

  // Fire-and-forget notification email
  void (async () => {
    try {
      const { sendMail } = await import('@/lib/email/mailer');
      const subj =
        newStatus === 'approved'
          ? `Tixly — akreditace schválena: ${row.event_title}`
          : newStatus === 'rejected'
            ? `Tixly — akreditace zamítnuta: ${row.event_title}`
            : `Tixly — akreditace zrušena: ${row.event_title}`;
      const bodyHtml =
        newStatus === 'approved'
          ? `<p>Dobrý den ${row.applicant_name},</p>
             <p>tvoje žádost o akreditaci (${row.category}) na <strong>${row.event_title}</strong>
             byla <strong style="color:#10b981">schválena</strong>.</p>
             <p>Pořadatel ti pošle vstupenku samostatným emailem.</p>`
          : newStatus === 'rejected'
            ? `<p>Dobrý den ${row.applicant_name},</p>
             <p>tvoje žádost o akreditaci (${row.category}) na <strong>${row.event_title}</strong>
             byla <strong style="color:#dc2626">zamítnuta</strong>.</p>
             ${parsed.data.rejectionReason ? `<p>Důvod: ${parsed.data.rejectionReason}</p>` : ''}`
            : `<p>Žádost byla zrušena.</p>`;
      await sendMail({
        to: row.applicant_email,
        subject: subj,
        html: `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;padding:24px">${bodyHtml}</body></html>`,
      });
    } catch (err) {
      console.error('[accreditation] notification email failed:', err);
    }
  })();

  return NextResponse.json({ ok: true, status: newStatus });
}
