/**
 * PATCH /api/admin/events/[id]/accreditation/[reqId]
 * Body: { action: 'approve' | 'reject' | 'cancel', rejectionReason? }
 *
 * Po approve odešle mail aplikantovi (fire-and-forget).
 * Vystavení comp ticketu = další task (vyžaduje vybrat ticket_type kind='accreditation').
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { createOrGetGuestUser } from '@/lib/identity/guest-user';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';


const patchSchema = z.object({
  action: z.enum(['approve', 'reject', 'cancel']),
  rejectionReason: z.string().max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; reqId: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id) || !/^[0-9a-f-]{36}$/i.test(params.reqId)) {
    return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
  }

  const body: unknown = await req.json().catch(() => ({}));
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
  const row = r.rows[0];

  // Comp ticket auto-issuance po approve.
  // Hledáme ticket_type kind='accreditation' (zero-price). Pokud chybí, ticket
  // se nevystavuje (promotér ho musí vytvořit první).
  let issuedTicketId: string | null = null;
  if (newStatus === 'approved') {
    issuedTicketId = await issueCompTicket({
      eventId: params.id,
      requestId: params.reqId,
      applicantEmail: row.applicant_email,
      applicantName: row.applicant_name,
      promoterUserId: promoter.userId,
    });
  }

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

  return NextResponse.json({ ok: true, status: newStatus, issuedTicketId });

  });
}

/**
 * Vystaví comp ticket pro approved akreditaci. Hledá ticket_type s kind='accreditation'
 * (nebo base_price=0). Vytvoří shadow user, payment_provider='free' order, comp ticket.
 * Vrací ticket ID nebo null pokud nelze (chybí accreditation ticket type).
 */
async function issueCompTicket(input: {
  eventId: string;
  requestId: string;
  applicantEmail: string;
  applicantName: string;
  promoterUserId: string;
}): Promise<string | null> {
  const { randomUUID, randomBytes } = await import('crypto');
  const { encryptSecret } = await import('@/lib/crypto');

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Najdi accreditation ticket type (nebo zero-price fallback)
    const ttRes = await client.query<{ id: string; currency: string }>(
      `SELECT tt.id, e.currency
       FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
       WHERE tt.event_id = $1
         AND (tt.kind = 'accreditation' OR tt.base_price = 0)
         AND tt.remaining_qty > 0
       ORDER BY tt.kind = 'accreditation' DESC, tt.created_at ASC
       LIMIT 1
       FOR UPDATE`,
      [input.eventId],
    );
    if (ttRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const tt = ttRes.rows[0];

    // Find or create shadow user (anonymní akreditační účet)
    const userId = await createOrGetGuestUser(client, {
      email: input.applicantEmail,
      name: input.applicantName,
    });

    const orderId = randomUUID();
    await client.query(
      `INSERT INTO orders.orders
         (id, user_id, event_id, status, total_amount, currency, locale,
          gopay_payment_id, payment_provider, idempotency_key,
          discount_halire, requires_age_verification, paid_at,
          expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'paid', 0, $4, 'cs',
               $5, 'free', $6,
               0, FALSE, NOW(),
               NOW() + INTERVAL '1 day', NOW(), NOW())`,
      [
        orderId,
        userId,
        input.eventId,
        tt.currency,
        `accr-${input.requestId.slice(0, 8)}`,
        randomUUID(),
      ],
    );
    await client.query(
      `INSERT INTO orders.order_items
         (order_id, ticket_type_id, quantity, unit_price, total_price)
       VALUES ($1, $2, 1, 0, 0)`,
      [orderId, tt.id],
    );

    const ticketId = randomUUID();
    const totpRaw = randomBytes(20);
    const encrypted = Buffer.from(encryptSecret(totpRaw.toString('base64')), 'base64');

    await client.query(
      `INSERT INTO tickets.tickets
         (id, order_id, ticket_type_id, owner_id, original_owner_id,
          status, totp_secret_encrypted, totp_secret_iv, original_price)
       VALUES ($1, $2, $3, $4, $4, 'valid', $5, $6, 0)`,
      [ticketId, orderId, tt.id, userId, encrypted, Buffer.alloc(0)],
    );

    await client.query(
      `UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - 1 WHERE id = $1`,
      [tt.id],
    );

    await client.query(
      `UPDATE marketing.accreditation_requests
       SET issued_ticket_id = $2, updated_at = NOW()
       WHERE id = $1`,
      [input.requestId, ticketId],
    );

    await client.query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
       VALUES ('tickets', 'tickets', $1, 'INSERT', $2, 'user', $3::jsonb)`,
      [
        ticketId,
        input.promoterUserId,
        JSON.stringify({
          kind: 'accreditation_comp_issuance',
          request_id: input.requestId,
          applicant_email: input.applicantEmail,
        }),
      ],
    );

    await client.query('COMMIT');
    return ticketId;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[issueCompTicket]', err);
    return null;
  } finally {
    client.release();
  }
}
