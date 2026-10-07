/**
 * GET /api/admin/scanner/manifest?eventId=<uuid>[&eventDayId=<uuid>]
 *
 * Vrátí offline seznam vstupenek termínu (lib/scanner/offline-manifest — kolo 14: platné, použité i zrušené vstupenky
 * s údaji, podle kterých skener offline rozhoduje stejně jako online).
 * Scanner si ho stáhne PŘED začátkem představení a uloží do IndexedDB. Při výpadku
 * sítě pak offline ověřuje sken proti tomuto whitelistu (+ lokální evidence použití),
 * místo slepého „optimistic accept" — padělaný / cizí lístek se offline odmítne.
 *
 * Bezpečnost: scoped na promotéra (vlastní akce), runAsActivePromoter. Vrací jen
 * ticket UUID, stav, kategorie, místo, otisky tokenů a časově omezené TOTP kódy — žádné PII. Strop 100k řádků.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { buildOfflineManifest } from '@/lib/scanner/offline-manifest';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const url = new URL(req.url);
    const eventId = url.searchParams.get('eventId');
    if (!eventId || !UUID_RE.test(eventId)) {
      return NextResponse.json({ error: 'eventId required' }, { status: 422 });
    }

    // Ownership: akce musí patřit promotérovi (RLS je v prod dormantní).
    const owns = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [eventId, promoter.promoterId],
    );
    if (owns.rowCount === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Kolo 14: stav, kategorie s průkazem, otisky tiskových tokenů a omezené okno TOTP kódů — offline stejná pravidla jako online
    const client = await db().connect();
    try {
      return NextResponse.json(await buildOfflineManifest(client, eventId));
    } finally {
      client.release();
    }
  });
}
