/**
 * POST /api/internal/cron/release-expired-seat-holds
 *
 * Vyčistí expirované seat holdy v `catalog.event_seats`. Volá se cca každou
 * minutu z external scheduleru (Vercel Cron, K8s CronJob, Railway Cron).
 *
 * Bez tohoto cronu by expired holdy zůstávaly držet sedadla věčně — jiný
 * kupec by je nemohl rezervovat, protože hold/route.ts zruší pouze své vlastní
 * předchozí holdy (per session tag). Pro multi-buyer kontení je nutný
 * background sweep.
 *
 * Auth: x-internal-token (timing-safe equal).
 *
 * Response: { releasedCount: number, ts: string }
 */

import { timingSafeEqual } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';


function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Uvolňuje se i `hold_kind` a `hold_label`. Bez toho zůstávalo u promotérského
  // holdu s datem uvolnění sedadlo v prodeji, ale v přehledu držených míst se
  // dál tvářilo jako držené — dva různé stavy pro totéž místo.
  // Vyřazená místa (status='blocked', technika) se nikdy neuvolňují časem.
  // Pozn.: `RETURNING` vrací nové hodnoty, takže původní `hold_kind` se musí
  // odečíst dřív, než ho UPDATE přepíše — proto CTE. `SKIP LOCKED` nechá být
  // řádky, které si právě drží běžící checkout, a sebere je příští běh.
  const r = await db().query<{ id: string; hold_kind: string | null }>(
    `WITH expired AS (
       SELECT id, hold_kind
       FROM catalog.event_seats
       WHERE status = 'held'
         AND hold_until IS NOT NULL
         AND hold_until < NOW()
       FOR UPDATE SKIP LOCKED
     ), released AS (
       UPDATE catalog.event_seats es
       SET status = 'available',
           hold_user_id = NULL,
           hold_until = NULL,
           hold_kind = NULL,
           hold_label = NULL,
           notes = NULL,
           updated_at = NOW()
       FROM expired e
       WHERE es.id = e.id
       RETURNING es.id
     )
     SELECT e.id, e.hold_kind FROM expired e`,
  );

  // Rozlišení pro monitoring: zákaznické holdy expirují běžně (nedokončený
  // nákup), promotérské jen tehdy, když jim promotér nastavil datum uvolnění.
  let promoterHolds = 0;
  for (const row of r.rows) {
    if (row.hold_kind !== null && row.hold_kind !== 'customer') promoterHolds += 1;
  }

  return NextResponse.json({
    releasedCount: r.rows.length,
    promoterHoldsReleased: promoterHolds,
    ts: new Date().toISOString(),
  });

  });
}
