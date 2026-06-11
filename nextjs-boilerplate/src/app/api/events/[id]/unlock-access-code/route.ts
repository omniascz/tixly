/**
 * POST /api/events/[id]/unlock-access-code  { code: string }
 *
 * Buyer zadá přístupový kód v event page. Pokud je validní, vrátí seznam
 * ticket_type_id, které ten kód odemyká. Klient si je přidá do UI.
 *
 * **Nezapočítává `uses_count` zde** — počítadlo se zvyšuje až při checkoutu,
 * až buyer reálně koupí (jinak by stačilo klikat 100× a vyčerpat kód).
 *
 * Validace:
 *  - kód existuje pro daný event
 *  - valid_from ≤ now ≤ valid_until
 *  - uses_count < max_uses (pokud limit)
 *
 * Bezpečnost: žádný auth (kódy jsou public sharable URL). Rate-limit per (IP, eventId)
 * 20 pokusů / 5 min, brání brute-force.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit/per-tenant';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

const schema = z.object({
  code: z.string().min(1).max(40),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  // Rate limit per (IP, eventId): 20 pokusů / 5 minut. Brání brute-force kódů.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';
  const rlKey = `unlock:${params.id}:${ip}`;
  const rl = await checkRateLimit(rlKey, { limit: 20, windowMs: 5 * 60 * 1000 });
  const rlResp = rateLimitResponse(rl, 'unlock-access-code');
  if (rlResp) return rlResp;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 422 });
  }
  const code = parsed.data.code.trim().toUpperCase();
  const eventId = params.id;

  // access_codes jsou TAJNÉ kódy (žádná public-read RLS policy záměrně). Validace
  // kódu = kontrola "hesla" → běží v service kontextu (trusted lookup), ne jako
  // anonym (ten by řádek pod RLS neviděl → vždy INVALID_CODE).
  return runWithServiceContext(async () => {
  const r = await db().query<{
    id: string;
    max_uses: number | null;
    uses_count: number;
    not_yet_valid: boolean;
    expired: boolean;
    ticket_type_ids: string[] | null;
    ticket_type_names: string[] | null;
  }>(
    `SELECT ac.id, ac.max_uses, ac.uses_count,
            (ac.valid_from IS NOT NULL AND ac.valid_from > now())   AS not_yet_valid,
            (ac.valid_until IS NOT NULL AND ac.valid_until < now()) AS expired,
            (SELECT array_agg(actt.ticket_type_id)
               FROM catalog.access_code_ticket_types actt
               WHERE actt.access_code_id = ac.id) AS ticket_type_ids,
            (SELECT array_agg(tt.name)
               FROM catalog.access_code_ticket_types actt
               JOIN catalog.ticket_types tt ON tt.id = actt.ticket_type_id
               WHERE actt.access_code_id = ac.id) AS ticket_type_names
     FROM catalog.access_codes ac
     WHERE ac.event_id = $1 AND UPPER(ac.code) = $2`,
    [eventId, code],
  );
  if (r.rows.length === 0) {
    return NextResponse.json(
      { error: 'INVALID_CODE', message: 'Kód neexistuje pro tuto akci.' },
      { status: 404 },
    );
  }
  const ac = r.rows[0];
  // Platnost vyhodnocuje DB svým now() — neporovnávat DB-timestamp proti JS new Date()
  // (DB a app server jsou jiné stroje, clock skew by čerstvý kód chybně odmítl).
  if (ac.not_yet_valid) {
    return NextResponse.json(
      { error: 'NOT_YET_VALID', message: 'Kód zatím není platný.' },
      { status: 409 },
    );
  }
  if (ac.expired) {
    return NextResponse.json(
      { error: 'EXPIRED', message: 'Kód vypršel.' },
      { status: 409 },
    );
  }
  if (ac.max_uses !== null && ac.uses_count >= ac.max_uses) {
    return NextResponse.json(
      { error: 'EXHAUSTED', message: 'Kód byl vyčerpán.' },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    accessCodeId: ac.id,
    ticketTypeIds: ac.ticket_type_ids ?? [],
    ticketTypeNames: ac.ticket_type_names ?? [],
  });
  });
}
