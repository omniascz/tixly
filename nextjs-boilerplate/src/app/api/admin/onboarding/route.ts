/**
 * GET /api/admin/onboarding
 *
 * Vrátí checklist progress promotéra:
 *   - kyc_submitted: KYC formulář vyplněn
 *   - kyc_approved: master admin schválil
 *   - branding_set: alespoň logo nebo primary color
 *   - first_event: existuje >= 1 published event
 *   - first_payout_setup: bank_account vyplněn
 *   - first_team_member: alespoň jeden další člen týmu
 *   - first_payment: existuje paid order
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  href: string;
  required: boolean;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<{
    kyc_status: string;
    bank_account: string | null;
    has_branding: boolean;
    published_events: string;
    team_size: string;
    paid_orders: string;
  }>(
    `SELECT
       p.kyc_status,
       p.bank_account,
       (EXISTS (SELECT 1 FROM platform.promoter_branding WHERE promoter_id = p.id
         AND (logo_url IS NOT NULL OR primary_color IS NOT NULL))) AS has_branding,
       (SELECT COUNT(*)::text FROM catalog.events WHERE promoter_id = p.id AND status = 'published') AS published_events,
       (SELECT COUNT(*)::text FROM platform.promoter_members WHERE promoter_id = p.id) AS team_size,
       (SELECT COUNT(*)::text FROM orders.orders o
        JOIN catalog.events e ON e.id = o.event_id
        WHERE e.promoter_id = p.id AND o.status IN ('paid','paid_partial')) AS paid_orders
     FROM platform.promoters p
     WHERE p.id = $1`,
    [promoter.promoterId],
  );
  if (r.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const d = r.rows[0]!;

  const items: ChecklistItem[] = [
    {
      id: 'kyc_submitted',
      label: 'Vyplň KYC údaje',
      description: 'IČO, adresa, bankovní účet, DPH nastavení',
      completed: ['submitted', 'approved'].includes(d.kyc_status),
      href: '/admin/settings/kyc',
      required: true,
    },
    {
      id: 'kyc_approved',
      label: 'Čekej na schválení účtu',
      description: 'Master admin ověří údaje (typicky do 24h)',
      completed: d.kyc_status === 'approved',
      href: '/admin/settings/kyc',
      required: true,
    },
    {
      id: 'branding_set',
      label: 'Nastav branding',
      description: 'Logo, barvy, social linky pro buyer-facing stránky',
      completed: d.has_branding,
      href: '/admin/settings/branding',
      required: false,
    },
    {
      id: 'first_event',
      label: 'Vytvoř první akci',
      description: 'Použij wizard, vyber template, publikuj',
      completed: Number(d.published_events) >= 1,
      href: '/admin/events/new',
      required: true,
    },
    {
      id: 'first_team_member',
      label: 'Pozvi člena týmu',
      description: 'Owner / admin / staff pro spolupráci',
      completed: Number(d.team_size) >= 2,
      href: '/admin/team',
      required: false,
    },
    {
      id: 'first_payment',
      label: 'První zaplacená objednávka',
      description: 'Test prodeje (lze i seed test účtem)',
      completed: Number(d.paid_orders) >= 1,
      href: '/admin/events',
      required: false,
    },
  ];

  const completed = items.filter((i) => i.completed).length;
  const total = items.length;
  const requiredCompleted = items.filter((i) => i.required && i.completed).length;
  const requiredTotal = items.filter((i) => i.required).length;

  return NextResponse.json({
    items,
    progress: {
      completed,
      total,
      pct: Math.round((completed / total) * 100),
    },
    required: {
      completed: requiredCompleted,
      total: requiredTotal,
      ready: requiredCompleted === requiredTotal,
    },
  });
}
