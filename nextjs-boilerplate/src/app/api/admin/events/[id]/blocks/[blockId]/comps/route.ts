/**
 * POST /api/admin/events/[id]/blocks/[blockId]/comps — volné vstupenky z blokace na jména (kolo 8 / krok 3).
 * Body: { seats: [{ seatId, holderName }], recipientEmail?, recipientName? }
 * Bez e-mailu příjemce patří objednávka pořadateli (vstupenky na jména rozdá sám).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { createOrGetGuestUser } from '@/lib/identity/guest-user';
import { BlockError, issueBlockComps } from '@/lib/theatre/blocks';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;
const schema = z.object({
  seats: z.array(z.object({ seatId: z.string().uuid(), holderName: z.string().trim().min(1).max(200) })).min(1).max(100),
  recipientEmail: z.string().email().max(320).optional(),
  recipientName: z.string().max(200).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string; blockId: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!UUID.test(params.id) || !UUID.test(params.blockId)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const { recipientEmail } = parsed.data;
    // Uživatel příjemce se zakládá servisně, mimo transakci (stejně jako u holds/issue).
    const recipientUserId = recipientEmail
      ? await runWithServiceContext(() => createOrGetGuestUser(db(), {
          email: recipientEmail, name: parsed.data.recipientName ?? parsed.data.seats[0].holderName, onExisting: 'fillName',
        }))
      : promoter.userId;
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const r = await issueBlockComps(client, promoter, params.id, params.blockId, recipientUserId, parsed.data.seats);
      await client.query('COMMIT');
      return NextResponse.json(r, { status: 201 });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (e instanceof BlockError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
      throw e;
    } finally {
      client.release();
    }
  });
}
