/**
 * GET  /api/events/[id]/hospitality — public list (jen visibility='public' packages)
 * POST /api/events/[id]/hospitality — body { packageId, companyName, ... } → vytvoří inquiry
 *
 * Inquiry je first-touch — promotér ji manually potvrdí, vystaví fakturu mimo platformu.
 *
 * RLS: GET běží anon (public-published packages); POST v service kontextu —
 * veřejný B2B inquiry zápis na cizí event (jako guest write).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }
  const r = await db().query<{
    id: string;
    name: string;
    description: string | null;
    capacity: number;
    remaining_qty: number;
    price_minor: number;
    currency: string;
    includes: unknown;
  }>(
    `SELECT id, name, description, capacity, remaining_qty, price_minor, currency, includes
     FROM catalog.hospitality_packages
     WHERE event_id = $1 AND visibility = 'public' AND active = true AND remaining_qty > 0
     ORDER BY price_minor DESC`,
    [params.id],
  );
  return NextResponse.json({ packages: r.rows });
}

const inquirySchema = z.object({
  packageId: z.string().uuid(),
  companyName: z.string().min(1).max(200),
  companyVatId: z.string().max(50).optional(),
  contactName: z.string().min(1).max(120),
  contactEmail: z.string().email().max(200),
  contactPhone: z.string().max(40).optional(),
  quantity: z.number().int().min(1).max(100).default(1),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = inquirySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  return runWithServiceContext(async () => {
    const pkg = await db().query<{
      id: string;
      price_minor: number;
      currency: string;
      remaining_qty: number;
    }>(
      `SELECT id, price_minor, currency, remaining_qty
       FROM catalog.hospitality_packages
       WHERE id = $1 AND event_id = $2 AND active = true`,
      [parsed.data.packageId, params.id],
    );
    if (pkg.rows.length === 0) {
      return NextResponse.json({ error: 'PACKAGE_NOT_AVAILABLE' }, { status: 404 });
    }
    if (pkg.rows[0].remaining_qty < parsed.data.quantity) {
      return NextResponse.json(
        { error: 'INSUFFICIENT_REMAINING', available: pkg.rows[0].remaining_qty },
        { status: 409 },
      );
    }

    const totalAmount = pkg.rows[0].price_minor * parsed.data.quantity;

    const r = await db().query<{ id: string }>(
      `INSERT INTO orders.hospitality_inquiries
         (package_id, company_name, company_vat_id, contact_name, contact_email,
          contact_phone, quantity, notes, total_amount_minor, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        parsed.data.packageId,
        parsed.data.companyName,
        parsed.data.companyVatId ?? null,
        parsed.data.contactName,
        parsed.data.contactEmail.toLowerCase(),
        parsed.data.contactPhone ?? null,
        parsed.data.quantity,
        parsed.data.notes ?? null,
        totalAmount,
        pkg.rows[0].currency,
      ],
    );
    return NextResponse.json(
      { id: r.rows[0].id, totalAmount, currency: pkg.rows[0].currency },
      { status: 201 },
    );
  });
}
