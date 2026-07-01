/**
 * POST /api/buyer/agents/register — ověřený člověk zaregistruje nákupního agenta.
 * Body: { name }. Vrací API klíč JEN JEDNOU (ukládáme jen hash).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateAgentKey } from '@/lib/agents/mandate';
import { runAsUser } from '@/lib/auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

const schema = z.object({ name: z.string().min(1).max(80) });

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    const { key, hash } = generateAgentKey();
    return runWithServiceContext(async () => {
      try {
        const r = await db().query<{ id: string }>(
          `INSERT INTO platform.purchase_agents (owner_user_id, name, api_key_hash)
           VALUES ($1, $2, $3) RETURNING id`,
          [userId, parsed.data.name, hash],
        );
        return NextResponse.json(
          { agentId: r.rows[0].id, apiKey: key, note: 'Ulož si klíč — už se znovu nezobrazí.' },
          { status: 201 },
        );
      } catch {
        return NextResponse.json({ error: 'AGENT_LANE_UNAVAILABLE', message: 'Dostupné po nasazení (migrace 449).' }, { status: 503 });
      }
    });
  });
}
