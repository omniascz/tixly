/**
 * POST /api/buyer/tickets/[ticketId]/transfer
 *
 * Převod vstupenky na jiného registrovaného uživatele.
 *
 * Validace:
 *   1. x-user-id je vlastníkem ticketu (owner_id)
 *   2. ticket.status === 'valid' && order.status === 'paid'
 *   3. recipient existuje v identity.users (s daným emailem)
 *   4. recipient !== current owner (nelze poslat sám sobě)
 *
 * Transakce:
 *   - UPDATE owner_id, transfer_count++, device_binding_id = NULL
 *     (TOTP secret zachován — dynamický QR funguje pro nového vlastníka,
 *      starý vlastník už ticket nevidí ve svém /my-tickets)
 *   - Audit log
 *
 * Po commitu: fire-and-forget email pro recipienta + odesílatele.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { z } from 'zod';
import { escapeHtml } from '@/lib/html-escape/escape';


const schema = z.object({
  recipientEmail: z.string().email().max(320),
  message: z.string().max(500).optional(),
});

interface Row {
  id: string;
  status: string;
  ticket_type_id: string;
  owner_id: string;
  transfer_count: number;
  ticket_type_name: string;
  event_id: string;
  event_title: string;
  event_date: string;
  order_status: string;
  owner_email: string;
  owner_name: string | null;
}

function buildSenderEmail(input: {
  recipientEmail: string;
  eventTitle: string;
  eventDate: string;
  ticketTypeName: string;
}): string {
  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">
  <h2 style="color:#10b981">Lístek odeslán</h2>
  <p>Tvůj lístek byl převeden na <strong>${escapeHtml(input.recipientEmail)}</strong>.</p>
  <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
    <tr><td style="padding:6px;border-bottom:1px solid #eee"><strong>Akce</strong></td><td style="padding:6px;border-bottom:1px solid #eee">${escapeHtml(input.eventTitle)}</td></tr>
    <tr><td style="padding:6px;border-bottom:1px solid #eee"><strong>Datum</strong></td><td style="padding:6px;border-bottom:1px solid #eee">${escapeHtml(new Date(input.eventDate).toLocaleString('cs-CZ'))}</td></tr>
    <tr><td style="padding:6px;border-bottom:1px solid #eee"><strong>Typ</strong></td><td style="padding:6px;border-bottom:1px solid #eee">${escapeHtml(input.ticketTypeName)}</td></tr>
  </table>
  <p style="margin-top:24px;color:#666;font-size:13px">
    Lístek už nevidíš ve svých vstupenkách. Pokud to byla chyba, kontaktuj podporu — převody lze stornovat pouze administrátorem.
  </p>
</body></html>`;
}

function buildRecipientEmail(input: {
  senderEmail: string;
  senderName: string | null;
  eventTitle: string;
  eventDate: string;
  ticketTypeName: string;
  message: string | null;
  myTicketsUrl: string;
}): string {
  const senderLabel = input.senderName ? `${input.senderName} (${input.senderEmail})` : input.senderEmail;
  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">
  <h1 style="color:#3b82f6">Dostal jsi vstupenku!</h1>
  <p><strong>${escapeHtml(senderLabel)}</strong> ti přeposlal vstupenku.</p>
  <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Akce</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(input.eventTitle)}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Datum</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(new Date(input.eventDate).toLocaleString('cs-CZ'))}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Typ</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(input.ticketTypeName)}</td></tr>
  </table>
  ${input.message ? `<blockquote style="margin:16px 0;padding:12px 16px;background:#f3f4f6;border-left:3px solid #3b82f6;font-size:13px;font-style:italic">${escapeHtml(input.message)}</blockquote>` : ''}
  <p style="margin-top:24px">
    <a href="${escapeHtml(input.myTicketsUrl)}" style="display:inline-block;background:#3b82f6;color:white;padding:10px 18px;border-radius:6px;text-decoration:none">Zobrazit moje lístky →</a>
  </p>
  <p style="margin-top:24px;color:#999;font-size:12px">
    Pokud nemáš účet na Tixly, zaregistruj se s tímto emailem a lístek se ti zobrazí automaticky.
  </p>
</body></html>`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {

  if (!/^[0-9a-f-]{36}$/i.test(params.ticketId)) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 422 });
  }

  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 422 });
  }
  const recipientEmail = parsed.data.recipientEmail.trim().toLowerCase();

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const t = await client.query<Row>(
      `SELECT t.id, t.status, t.ticket_type_id, t.owner_id, t.transfer_count,
              tt.name AS ticket_type_name,
              o.event_id, o.status AS order_status,
              e.title AS event_title, e.event_date::text AS event_date,
              u.email AS owner_email, u.name AS owner_name
       FROM tickets.tickets t
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       JOIN orders.orders o ON o.id = t.order_id
       JOIN catalog.events e ON e.id = o.event_id
       JOIN identity.users u ON u.id = t.owner_id
       WHERE t.id = $1
       FOR UPDATE`,
      [params.ticketId],
    );
    if (t.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'TICKET_NOT_FOUND' }, { status: 404 });
    }
    const ticket = t.rows[0];

    if (ticket.owner_id !== userId) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'NOT_OWNER', message: 'Můžeš převést jen vlastní lístek.' },
        { status: 403 },
      );
    }
    if (ticket.status !== 'valid') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'TICKET_NOT_VALID', status: ticket.status },
        { status: 409 },
      );
    }
    if (ticket.order_status !== 'paid') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'ORDER_NOT_PAID' }, { status: 409 });
    }
    if (recipientEmail === ticket.owner_email.toLowerCase()) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'SELF_TRANSFER', message: 'Nelze převést lístek sám sobě.' },
        { status: 422 },
      );
    }

    const rec = await client.query<{ id: string; name: string | null }>(
      `SELECT id, name FROM identity.users WHERE LOWER(email) = $1 LIMIT 1`,
      [recipientEmail],
    );
    if (rec.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: 'RECIPIENT_NOT_FOUND',
          message:
            'Příjemce s tímto emailem nemá účet na Tixly. Pošli mu link na registraci a zkus to znovu.',
        },
        { status: 422 },
      );
    }
    const recipientId = rec.rows[0].id;

    await client.query(
      `UPDATE tickets.tickets
       SET owner_id = $1,
           transfer_count = transfer_count + 1,
           device_binding_id = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [recipientId, ticket.id],
    );

    await client.query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_id, actor_type,
          old_values, new_values)
       VALUES ('tickets', 'tickets', $1, 'UPDATE', $2, 'user', $3::jsonb, $4::jsonb)`,
      [
        ticket.id,
        userId,
        JSON.stringify({ owner_id: ticket.owner_id }),
        JSON.stringify({
          kind: 'transfer',
          new_owner_id: recipientId,
          recipient_email: recipientEmail,
          transfer_count: ticket.transfer_count + 1,
          message: parsed.data.message ?? null,
        }),
      ],
    );

    await client.query('COMMIT');

    void (async () => {
      try {
        const { sendMail } = await import('@/lib/email/mailer');
        const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
        const myTicketsUrl = `${appUrl}/cs/my-tickets`;

        await sendMail({
          to: recipientEmail,
          subject: `Tixly — dostal jsi vstupenku na ${ticket.event_title}`,
          html: buildRecipientEmail({
            senderEmail: ticket.owner_email,
            senderName: ticket.owner_name,
            eventTitle: ticket.event_title,
            eventDate: ticket.event_date,
            ticketTypeName: ticket.ticket_type_name,
            message: parsed.data.message ?? null,
            myTicketsUrl,
          }),
        });
        await sendMail({
          to: ticket.owner_email,
          subject: `Tixly — lístek odeslán na ${recipientEmail}`,
          html: buildSenderEmail({
            recipientEmail,
            eventTitle: ticket.event_title,
            eventDate: ticket.event_date,
            ticketTypeName: ticket.ticket_type_name,
          }),
        });
      } catch (err) {
        console.error('[transfer] email failed:', err);
      }
    })();

    return NextResponse.json({
      ok: true,
      ticketId: ticket.id,
      recipientEmail,
      transferCount: ticket.transfer_count + 1,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/buyer/tickets/[id]/transfer]', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
