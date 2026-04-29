// GET/POST /api/promoters/[promoterId]/cashback/event-boosts

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import {
  createEventBoost,
  listEventBoosts,
} from '../../../../../../services/cashback.service.js';
import { CashbackError } from '../../../../../../lib/cashback-errors.js';

function ensureAdmin(req: Request): Response | null {
  if (req.headers.get('x-user-role') !== 'admin') {
    return NextResponse.json(
      { error: 'Vyžadována role admin.' },
      { status: 403 },
    );
  }
  return null;
}

export async function GET(
  req: Request,
  ctx: { params: { promoterId: string } },
): Promise<Response> {
  const denied = ensureAdmin(req);
  if (denied) return denied;

  const deps = await getServiceDeps();
  const items = await listEventBoosts(deps, ctx.params.promoterId);
  return NextResponse.json({ items });
}

const CreateSchema = z.object({
  eventId: z.string().uuid(),
  boostBps: z.number().int().min(0).max(2000),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime(),
});

export async function POST(
  req: Request,
  ctx: { params: { promoterId: string } },
): Promise<Response> {
  const denied = ensureAdmin(req);
  if (denied) return denied;

  try {
    const parsed = CreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Neplatný vstup.', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const deps = await getServiceDeps();
    await createEventBoost(deps, {
      eventId: parsed.data.eventId,
      promoterId: ctx.params.promoterId,
      boostBps: parsed.data.boostBps,
      validFrom: new Date(parsed.data.validFrom),
      validUntil: new Date(parsed.data.validUntil),
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    if (err instanceof CashbackError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: 'Interní chyba serveru.' },
      { status: 500 },
    );
  }
}
