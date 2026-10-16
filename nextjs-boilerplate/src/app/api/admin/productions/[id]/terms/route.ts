/**
 * POST /api/admin/productions/[id]/terms — nový termín inscenace na pár kliknutí (kolo 8 / krok 1).
 * Body: { venueId, dateStart, dateEnd?, salesEndAt?, termNote?, castAlternation?, copyPricingFromEventId? | ticketTypes[] }
 * Údaje z inscenace, ceník z předchozího termínu nebo zadaný, sedadla z plánku sálu (lib/theatre/terms.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { createTerm, TermError } from '@/lib/theatre/terms';

export const dynamic = 'force-dynamic';

const schema = z.object({
  venueId: z.string().uuid(),
  dateStart: z.string().datetime({ offset: true }),
  dateEnd: z.string().datetime({ offset: true }).nullable().optional(),
  salesEndAt: z.string().datetime({ offset: true }).nullable().optional(),
  termNote: z.string().max(1000).nullable().optional(),
  castAlternation: z.string().max(2000).nullable().optional(),
  copyPricingFromEventId: z.string().uuid().nullable().optional(),
  zonePrices: z.array(z.object({
    zone: z.string().min(1).max(100),
    priceHalire: z.number().int().min(0),
    vatRateCode: z.string().max(40).nullable().optional(),
  })).max(50).optional(),
  ticketTypes: z.array(z.object({
    name: z.string().min(1).max(100),
    priceHalire: z.number().int().min(0),
    capacity: z.number().int().min(1).max(100000).optional(),
    zone: z.string().min(1).max(100).nullable().optional(),
    isSeated: z.boolean().optional(),
    vatRateCode: z.string().max(40).nullable().optional(),
    maxPerUser: z.number().int().min(1).max(100).nullable().optional(),
  })).max(50).optional(),
});

const STATUS: Record<TermError['code'], number> = {
  PRODUCTION_NOT_FOUND: 404, VENUE_NOT_FOUND: 404, SOURCE_NOT_FOUND: 404, NO_TICKET_TYPES: 422, VAT_NOT_CONFIGURED: 422, NO_SELLABLE_SEATS: 422,
};

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    if (parsed.data.salesEndAt && parsed.data.dateEnd && parsed.data.salesEndAt > parsed.data.dateEnd) {
      return NextResponse.json({ error: 'SALES_END_AFTER_EVENT_END' }, { status: 422 });
    }
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const r = await createTerm(client, promoter.promoterId, promoter.userId, { productionId: params.id, ...parsed.data });
      await client.query('COMMIT');
      return NextResponse.json(r, { status: 201 });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (err instanceof TermError) {
        return NextResponse.json({ error: err.code, message: err.message, details: err.details }, { status: STATUS[err.code] });
      }
      throw err;
    } finally {
      client.release();
    }
  });
}
