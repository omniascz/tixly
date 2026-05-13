/**
 * POST /api/platform/admin/cron/auto-price
 *
 * Cron endpoint pro automatickou úpravu cen všech aktivních eventů.
 * Volá se periodicky (např. každých 15 minut).
 * Zabezpečen API klíčem platformy (x-platform-key).
 */

import { NextRequest, NextResponse } from 'next/server';
import { autoAdjustPrices, ServiceDeps } from '../../../../../../services/dynamic-pricing.service.js';
import type { DbAdapter } from '@tixly/rls-multitenancy';

function getDb(): DbAdapter {
  throw new Error(
    'getDb() musí být napojen na reálný DbAdapter před nasazením.',
  );
}

function getDeps(): ServiceDeps {
  return { db: getDb() };
}

interface ActiveEventRow {
  id: string;
  promoter_id: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const platformKey = request.headers.get('x-platform-key');
  if (!platformKey) {
    return NextResponse.json(
      { error: 'Neoprávněný přístup. Chybí x-platform-key.' },
      { status: 401 },
    );
  }

  let deps: ServiceDeps;
  try {
    deps = getDeps();
  } catch {
    return NextResponse.json({ error: 'Interní chyba serveru' }, { status: 500 });
  }

  try {
    // Get all active events with dynamic pricing enabled
    const eventsResult = await deps.db.query<ActiveEventRow>(
      `SELECT DISTINCT e.id, e.promoter_id
       FROM catalog.events e
       INNER JOIN pricing.rules r ON r.event_id = e.id
       WHERE e.start_date > NOW() AND e.status = 'published'`,
      [],
    );

    let totalAdjusted = 0;
    let totalSkipped = 0;

    for (const event of eventsResult.rows) {
      try {
        const result = await autoAdjustPrices(event.id, event.promoter_id, deps);
        totalAdjusted += result.adjusted;
        totalSkipped += result.skipped;
      } catch (err) {
        console.error(`[cron/auto-price] Chyba pro event ${event.id}:`, err);
        totalSkipped++;
      }
    }

    return NextResponse.json({
      eventsProcessed: eventsResult.rows.length,
      totalAdjusted,
      totalSkipped,
    });
  } catch (err) {
    console.error('[cron/auto-price] Chyba:', err);
    return NextResponse.json({ error: 'Interní chyba serveru' }, { status: 500 });
  }
}
