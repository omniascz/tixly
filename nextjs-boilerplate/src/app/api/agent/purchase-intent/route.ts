/**
 * POST /api/agent/purchase-intent — agent-facing.
 *
 * Nákupní AI agent (hlavička x-agent-key) požádá o autorizaci nákupu. Server ověří:
 *  1) agent je registrovaný a aktivní (vázaný na ověřeného člověka),
 *  2) delegovaný mandát pokrývá nákup (cena/počet/akce/platnost),
 *  3) fér-pravidla platí per člověk-vlastník (anti-scalping).
 * Vrátí autorizaci k pokračování do checkoutu (delegovaná platba = na klíč).
 *
 * Body: { eventId, ticketTypeId, qty, unitPriceMinor? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hashKey, checkMandate, type MandateRow } from '@/lib/agents/mandate';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

const schema = z.object({
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  qty: z.number().int().min(1).max(50),
  unitPriceMinor: z.number().int().min(0).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const key = req.headers.get('x-agent-key');
  if (!key) return NextResponse.json({ error: 'AGENT_KEY_REQUIRED' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
  const ask = parsed.data;

  return runWithServiceContext(async () => {
    try {
      const agentR = await db().query<{ id: string; owner_user_id: string; status: string }>(
        `SELECT id, owner_user_id, status FROM platform.purchase_agents WHERE api_key_hash = $1`,
        [hashKey(key)],
      );
      const agent = agentR.rows[0];
      if (!agent || agent.status !== 'active') {
        return NextResponse.json({ error: 'INVALID_AGENT' }, { status: 401 });
      }

      // Efektivní cena vstupenky (dynamic pokud je, jinak base).
      const ttR = await db().query<{ base_price: number; dynamic_price_minor: number | null }>(
        `SELECT base_price, dynamic_price_minor FROM catalog.ticket_types
          WHERE id = $1 AND event_id = $2`,
        [ask.ticketTypeId, ask.eventId],
      );
      if (ttR.rows.length === 0) return NextResponse.json({ error: 'TICKET_TYPE_NOT_FOUND' }, { status: 404 });
      const effectivePrice = ask.unitPriceMinor ?? ttR.rows[0].dynamic_price_minor ?? ttR.rows[0].base_price;

      // Nejvhodnější aktivní mandát (specifický pro akci má přednost).
      const mR = await db().query<MandateRow>(
        `SELECT id, user_id, event_id, max_price_minor, max_qty, used_qty, status, expires_at::text
           FROM platform.agent_mandates
          WHERE agent_id = $1 AND user_id = $2 AND status = 'active'
            AND (event_id IS NULL OR event_id = $3) AND expires_at > NOW()
          ORDER BY (event_id = $3) DESC NULLS LAST, expires_at ASC
          LIMIT 1`,
        [agent.id, agent.owner_user_id, ask.eventId],
      );
      const check = checkMandate(mR.rows[0], { eventId: ask.eventId, qty: ask.qty, unitPriceMinor: effectivePrice }, new Date());
      if (!check.ok) {
        return NextResponse.json({ authorized: false, reason: check.reason }, { status: 403 });
      }

      // Fér-pravidla: limit na osobu je vázaný na člověka-vlastníka (ne na agenta/IP)
      // → whitelisted agent nemůže obejít per-buyer limity. (Vynucení v checkoutu
      // proti owner_user_id, stejná cesta jako u lidského nákupu.)
      await db().query(`UPDATE platform.purchase_agents SET last_used_at = NOW() WHERE id = $1`, [agent.id]);

      return NextResponse.json({
        authorized: true,
        ownerUserId: agent.owner_user_id,
        mandateId: mR.rows[0].id,
        eventId: ask.eventId,
        ticketTypeId: ask.ticketTypeId,
        qty: ask.qty,
        unitPriceMinor: effectivePrice,
        remainingQty: check.remainingQty,
        note: 'Autorizováno. Delegovaná platba (ACP / Mastercard Agent Pay) je na klíč — po napojení protokolu.',
      });
    } catch {
      return NextResponse.json({ error: 'AGENT_LANE_UNAVAILABLE', message: 'Dostupné po nasazení (migrace 449).' }, { status: 503 });
    }
  });
}
