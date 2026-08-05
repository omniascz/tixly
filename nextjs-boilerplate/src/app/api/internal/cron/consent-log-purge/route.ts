/**
 * POST /api/internal/cron/consent-log-purge
 *
 * Smaž záznamy compliance.cookie_consent_log starší 90 dní.
 * GDPR data minimisation — audit log si držíme jen po nezbytně nutnou dobu.
 *
 * Auth: x-internal-token.
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

  try {
    const r = await db().query<{ count: string }>(
      `WITH del AS (
         DELETE FROM compliance.cookie_consent_log
          WHERE decided_at < NOW() - INTERVAL '90 days'
          RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM del`,
    );
    return NextResponse.json({ ok: true, purged: Number(r.rows[0]?.count ?? 0) });
  } catch (err) {
    // Puvodni catch polykal COKOLI a vracel {ok:true, purged:0} — to je
    // NEROZLISITELNE od poctiveho smazani nuly radku. GDPR purge tak mohl
    // tiche prestat fungovat a nikdo by se to nedozvedel.
    //
    // Komentar tu drive tvrdil "tabulka neexistuje, migrace neaplikovana".
    // Zmereno: compliance.cookie_consent_log EXISTUJE a DELETE nad ni projde,
    // takze ta premisa byla nepravdiva.
    //
    // Chytame proto VYHRADNE 42P01 (undefined_table) — jediny pripad, kdy je
    // preskoceni legitimni. Cokoli jineho propaguje 500, at je to videt.
    const code = (err as { code?: string }).code;
    if (code === '42P01') {
      console.warn('[consent-log-purge] tabulka neexistuje, preskakuji:', code);
      return NextResponse.json({ ok: true, purged: 0, skipped: 'table_missing' });
    }
    console.error('[consent-log-purge] SELHALO:', err);
    return NextResponse.json(
      { ok: false, purged: 0, error: 'PURGE_FAILED', code: code ?? null },
      { status: 500 },
    );
  }

  });
}
