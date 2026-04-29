// GET/PUT /api/promoters/[promoterId]/cashback/config

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import {
  getPromoterConfig,
  savePromoterConfig,
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

const ConfigSchema = z.object({
  maxRateBps: z.number().int().min(0).max(2000),
  tierBps: z.object({
    bronze: z.number().int().min(0),
    silver: z.number().int().min(0),
    gold: z.number().int().min(0),
    platinum: z.number().int().min(0),
  }),
  rfmCohortBps: z.record(z.number().int().min(0)),
  segmentBps: z.record(z.number().int().min(0)),
  defaultEventBoostBps: z.number().int().min(0).max(2000),
  cacheTtlSeconds: z.number().int().min(60).max(86400),
});

export async function GET(
  req: Request,
  ctx: { params: { promoterId: string } },
): Promise<Response> {
  const denied = ensureAdmin(req);
  if (denied) return denied;

  const deps = await getServiceDeps();
  const config = await getPromoterConfig(deps, ctx.params.promoterId);
  return NextResponse.json(config);
}

export async function PUT(
  req: Request,
  ctx: { params: { promoterId: string } },
): Promise<Response> {
  const denied = ensureAdmin(req);
  if (denied) return denied;

  try {
    const parsed = ConfigSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Neplatný config.', details: parsed.error.issues },
        { status: 400 },
      );
    }
    const deps = await getServiceDeps();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await savePromoterConfig(deps, ctx.params.promoterId, parsed.data as any);
    return NextResponse.json({ ok: true });
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
