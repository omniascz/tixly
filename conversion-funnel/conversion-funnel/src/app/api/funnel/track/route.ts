// POST /api/funnel/track
//
// Veřejný endpoint bez autentizace — tracking kroků funnelu.
// Fire-and-forget: vždy vrátí 202 Accepted i když interní zápis selže.
// GDPR: nepřijímáme ani neukládáme PII; userId je volitelné a interní.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { trackStep } from '@/services/funnel.service';
import { FUNNEL_STEPS } from '@/types/funnel.types';

// ─── Stubs (v produkci injektovat přes DI / env) ────────────────────────────

const db = {
  async query<T>(_sql: string, _params?: unknown[]): Promise<T[]> {
    return [];
  },
  async execute(_sql: string, _params?: unknown[]): Promise<void> {},
};

const kafka = {
  async send(_topic: string, _payload: unknown): Promise<void> {},
};

// ─── Validace ────────────────────────────────────────────────────────────────

const TrackBodySchema = z.object({
  sessionId: z.string().min(1),
  /** Interní userId — volitelné, anonymní tracking je plně podporován */
  userId: z.string().nullable().optional(),
  eventId: z.string().uuid(),
  step: z.enum(FUNNEL_STEPS as [string, ...string[]]),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = TrackBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { sessionId, userId, eventId, step, metadata } = parsed.data;

  // Fire-and-forget — trackStep nikdy nerozbije response
  trackStep(
    { db, kafka },
    {
      sessionId,
      userId: userId ?? null,
      eventId,
      step: step as import('@/types/funnel.types').FunnelStep,
      metadata,
    },
  );

  return NextResponse.json({ accepted: true }, { status: 202 });
}
