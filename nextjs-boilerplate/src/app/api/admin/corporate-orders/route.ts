/**
 * Firemní / skupinové objednávky na fakturu (kolo 8 / krok 6).
 *   GET  ?eventId= — seznam firemních objednávek pořadatele (volitelně termínu)
 *   POST — { eventId, company: { name, ico, dic?, address }, contact: { name, email, phone? }, blockId?,
 *            seats: [{ seatId, categoryId, priceMinor? }], priceOverrideReason?, dueDate }
 *          → místa držená do zaplacení, daňový doklad po sazbách (+ ISDOC) e-mailem kontaktu
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { TaxDocumentError } from '@/lib/accounting/documents';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { createOrGetGuestUser } from '@/lib/identity/guest-user';
import { BlockError, CategoryRuleError, CorporateError, createCorporateOrder, sendCorporateInvoiceMail } from '@/lib/theatre/corporate';

export const dynamic = 'force-dynamic';

const schema = z.object({
  eventId: z.string().uuid(),
  company: z.object({
    name: z.string().trim().min(1).max(200),
    ico: z.string().regex(/^\d{8}$/),
    dic: z.string().trim().max(20).nullable().optional(),
    address: z.string().trim().min(1).max(300),
  }),
  contact: z.object({ name: z.string().trim().min(1).max(200), email: z.string().email().max(320), phone: z.string().max(40).nullable().optional() }),
  blockId: z.string().uuid().nullable().optional(),
  seats: z.array(z.object({ seatId: z.string().uuid(), categoryId: z.string().uuid(), priceMinor: z.number().int().min(0).optional() })).min(1).max(500),
  priceOverrideReason: z.string().max(500).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const eventId = new URL(req.url).searchParams.get('eventId');
    if (eventId && !/^[0-9a-f-]{36}$/i.test(eventId)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const rows = (await db().query(
      `SELECT io.id, io.event_id AS "eventId", io.company_name AS "companyName", io.company_ico AS "companyIco", io.company_dic AS "companyDic",
              io.contact_name AS "contactName", io.contact_email AS "contactEmail", io.status, io.due_date::text AS "dueDate",
              io.total_amount_hellers::int AS "totalMinor", io.vat_amount_hellers::int AS "vatMinor", io.invoice_number AS "invoiceNumber",
              io.invoice_id AS "invoiceId", io.credit_note_id AS "creditNoteId", io.paid_at AS "paidAt", io.payment_reference AS "paymentReference",
              io.price_override_reason AS "priceOverrideReason", b.name AS "blockName",
              (SELECT COUNT(*)::int FROM orders.order_items oi WHERE oi.order_id = io.order_id) AS seats
         FROM b2b_orders.invoice_orders io LEFT JOIN catalog.seat_blocks b ON b.id = io.block_id
        WHERE io.promoter_id = $1 AND ($2::uuid IS NULL OR io.event_id = $2) AND io.order_id IS NOT NULL
        ORDER BY io.created_at DESC`,
      [promoter.promoterId, eventId],
    )).rows;
    return NextResponse.json({ orders: rows });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const input = parsed.data;
    if (new Set(input.seats.map((s) => s.seatId)).size !== input.seats.length) return NextResponse.json({ error: 'DUPLICATE_SEAT' }, { status: 422 });
    // zápis do identity.users je servisní operace (vzor box-office/sell, FINDINGS 86/87)
    const contactUserId = await runWithServiceContext(() =>
      createOrGetGuestUser(db(), { email: input.contact.email, name: input.contact.name }));
    const client = await db().connect();
    let res: Awaited<ReturnType<typeof createCorporateOrder>>;
    try {
      await client.query('BEGIN');
      res = await createCorporateOrder(client, { promoterId: promoter.promoterId, userId: promoter.userId, contactUserId }, input);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (err instanceof CorporateError || err instanceof BlockError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
      if (err instanceof CategoryRuleError || err instanceof TaxDocumentError) return NextResponse.json({ error: err.code, message: err.message }, { status: 422 });
      throw err;
    } finally {
      client.release();
    }
    let invoiceEmailed = true;
    await sendCorporateInvoiceMail(db(), res.invoiceId, input.contact.email).catch((e: unknown) => {
      invoiceEmailed = false;
      console.error('[corporate-orders] e-mail s fakturou selhal', e);
    });
    return NextResponse.json({ ...res, invoiceEmailed }, { status: 201 });
  });
}
