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
    // Tabulka neexistuje → migration neaplikována; vrať 200 ať cron nepadá
    console.warn('[consent-log-purge] skip:', err);
    return NextResponse.json({ ok: true, purged: 0, note: 'table missing or other error' });
  }

  });
}
