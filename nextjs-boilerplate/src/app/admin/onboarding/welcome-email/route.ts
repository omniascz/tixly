import { NextRequest, NextResponse } from 'next/server';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const row = await db().query<{ name: string; email: string }>(
      `SELECT name, email FROM platform.promoters WHERE id = $1`,
      [promoter.promoterId],
    );

    const p = row.rows[0];
    if (!p) {
      return NextResponse.json({ error: 'PROMOTER_NOT_FOUND' }, { status: 404 });
    }

    const now = new Date();
    const sequence = [
      {
        delay: '0d',
        subject: 'Vitejte v Tixly — vas prvni termin za 10 minut',
        body: `Ahoj ${p.name}, vas ucet je aktivni. Pujdte na /admin/onboarding a nastavte sve prvni predstaveni.`,
        scheduledAt: now.toISOString(),
      },
      {
        delay: '3d',
        subject: 'Jak nastavit mapu salu krok za krokem',
        body: `Sedaci sal vam umozni prodavat konkretni mista. Navod najdete v /admin/venues.`,
        scheduledAt: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
      },
      {
        delay: '7d',
        subject: 'Prvni prodej? Zde jsou vysledky vasich kolegu',
        body: `Nase nejuspesnejsi divadla prodavaji prvni vstupenky do 48 hodin od spusteni.`,
        scheduledAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      },
      {
        delay: '14d',
        subject: 'Tipy pro divadelni sezonu 2026/27',
        body: `Planovani sezony v Tixly — jak pridavat inscenace, opakujici se terminy a balickove predplatne.`,
        scheduledAt: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
      },
    ];

    console.info('[welcome-email] Would send email sequence to', p.email, JSON.stringify(sequence, null, 2));

    return NextResponse.json({ scheduled: sequence.length });
  });
}
