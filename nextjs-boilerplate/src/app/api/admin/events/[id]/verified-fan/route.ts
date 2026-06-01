/**
 * GET   /api/admin/events/[id]/verified-fan       — list pending/approved/rejected
 * POST  /api/admin/events/[id]/verified-fan/bulk  — bulk action { ids[], action }
 *
 * Action: approve (generuje presale codes + email), reject (s důvodem).
 *
 * Single-row decision přes /[reqId]/route.ts (samostatný endpoint).
 */

import { randomBytes } from 'crypto';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsActivePromoter } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';


async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events
     WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  if (!(await ownsEvent(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const r = await db().query(
    `SELECT vfr.id, vfr.user_id, u.email, u.name,
            vfr.status, vfr.presale_code, vfr.fan_motivation, vfr.email_domain,
            vfr.user_age_days, vfr.approved_at, vfr.rejected_reason,
            vfr.used_order_id, vfr.created_at
     FROM marketing.verified_fan_requests vfr
     JOIN identity.users u ON u.id = vfr.user_id
     WHERE vfr.event_id = $1
     ORDER BY
       CASE vfr.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'used' THEN 2 ELSE 3 END,
       vfr.created_at DESC`,
    [params.id],
  );

  const counts = await db().query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count
     FROM marketing.verified_fan_requests WHERE event_id = $1 GROUP BY status`,
    [params.id],
  );

  return NextResponse.json({
    eventId: params.id,
    requests: r.rows,
    counts: Object.fromEntries(counts.rows.map((c) => [c.status, Number(c.count)])),
  });

  });
}

const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(['approve', 'reject']),
  rejectionReason: z.string().max(500).optional(),
});

function generatePresaleCode(): string {
  return `PSL-${randomBytes(4).toString('hex').toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  if (!(await ownsEvent(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const newStatus = parsed.data.action === 'approve' ? 'approved' : 'rejected';
  const updates: Array<{ id: string; presaleCode: string | null; email: string; name: string }> = [];

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    for (const reqId of parsed.data.ids) {
      const code = parsed.data.action === 'approve' ? generatePresaleCode() : null;
      const r = await client.query<{ email: string; name: string }>(
        `UPDATE marketing.verified_fan_requests vfr
         SET status = $3,
             presale_code = $4,
             approved_at = CASE WHEN $3 = 'approved' THEN NOW() ELSE NULL END,
             rejected_reason = $5,
             updated_at = NOW()
         FROM identity.users u
         WHERE vfr.id = $1 AND vfr.event_id = $2 AND vfr.status = 'pending' AND u.id = vfr.user_id
         RETURNING u.email, u.name`,
        [reqId, params.id, newStatus, code, parsed.data.rejectionReason ?? null],
      );
      if (r.rows.length > 0) {
        updates.push({
          id: reqId,
          presaleCode: code,
          email: r.rows[0].email,
          name: r.rows[0].name ?? r.rows[0].email,
        });
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Fire-and-forget notification emails
  void (async () => {
    try {
      const { sendMail } = await import('@/lib/email/mailer');
      for (const u of updates) {
        await sendMail({
          to: u.email,
          subject:
            newStatus === 'approved'
              ? `Tixly — schválena Verified Fan registrace 🎉`
              : `Tixly — Verified Fan zamítnut`,
          html:
            newStatus === 'approved'
              ? `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;padding:24px">
                 <h1>Gratulujeme, jsi Verified Fan! 🎉</h1>
                 <p>Tvůj presale kód:</p>
                 <p style="font-size:20pt;font-family:monospace;letter-spacing:2pt;background:#f3f4f6;padding:12pt;text-align:center">${u.presaleCode}</p>
                 <p>Použij kód v presale window — link dostaneš samostatným emailem.</p>
                 <p style="color:#666;font-size:12px">Kód je jednorázový a vázán na tvůj účet. Nesdílej ho.</p>
                 </body></html>`
              : `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;padding:24px">
                 <p>Děkujeme za zájem o akci.</p>
                 <p>Bohužel se nedostalo na všechny — Verified Fan registrace byla zamítnuta.</p>
                 ${parsed.data.rejectionReason ? `<p><strong>Důvod:</strong> ${parsed.data.rejectionReason}</p>` : ''}
                 <p>Veřejný onsale stále proběhne — zkus to znova.</p>
                 </body></html>`,
        });
      }
    } catch (err) {
      console.error('[verified-fan bulk] email failed:', err);
    }
  })();

  return NextResponse.json({ ok: true, processed: updates.length });

  });
}
