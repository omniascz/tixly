/**
 * POST /api/buyer/agents/[id]/mandate — člověk udělí agentovi delegovaný mandát.
 * Body: { maxPriceMinor, maxQty, eventId?, expiresInHours }
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsUser } from '@/lib/auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

const schema = z.object({
  maxPriceMinor: z.number().int().min(0).max(100_000_000),
  maxQty: z.number().int().min(1).max(50),
  eventId: z.string().uuid().nullable().optional(),
  expiresInHours: z.number().int().min(1).max(720).default(24),
});

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsUser(req, async (userId) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'INVALID_ID' }, { status: 422 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const m = parsed.data;

    return runWithServiceContext(async () => {
      try {
        const agent = await db().query(
          `SELECT 1 FROM platform.purchase_agents WHERE id = $1 AND owner_user_id = $2 AND status = 'active'`,
          [params.id, userId],
        );
        if (agent.rows.length === 0) return NextResponse.json({ error: 'AGENT_NOT_FOUND' }, { status: 404 });

        const r = await db().query<{ id: string }>(
          `INSERT INTO platform.agent_mandates
             (agent_id, user_id, event_id, max_price_minor, max_qty, expires_at)
           VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' hours')::interval)
           RETURNING id`,
          [params.id, userId, m.eventId ?? null, m.maxPriceMinor, m.maxQty, String(m.expiresInHours)],
        );
        return NextResponse.json({ mandateId: r.rows[0].id }, { status: 201 });
      } catch {
        return NextResponse.json({ error: 'AGENT_LANE_UNAVAILABLE', message: 'Dostupné po nasazení (migrace 449).' }, { status: 503 });
      }
    });
  });
}
