import { NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
// Kolo 10: bez toho Next při buildu handler prerenderuje a čte DB (build padá / zapeče se stav z buildu).
export const dynamic = 'force-dynamic';

/**
 * GET /api/public/incidents — veřejné incidenty za posledních 14 dní.
 *
 * Vrací jen is_public=TRUE záznamy z platform.incidents (migrace 272).
 * Pre-migration fallback: vrátí prázdný seznam pokud tabulka neexistuje.
 */
export async function GET(): Promise<Response> {
  try {
    const r = await db().query<{
      id: string;
      title: string;
      status: string;
      started_at: string;
      resolved_at: string | null;
      description: string | null;
    }>(
      `SELECT id, title, status::text AS status, started_at::text AS started_at,
              resolved_at::text AS resolved_at, description
         FROM platform.incidents
        WHERE is_public = TRUE
          AND started_at > NOW() - INTERVAL '14 days'
        ORDER BY started_at DESC
        LIMIT 50`,
    );
    return NextResponse.json({ incidents: r.rows });
  } catch {
    return NextResponse.json({ incidents: [] });
  }
}
