import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PromoCodeService } from '../../../services/promo-code.service';

// Resolved via DI container in production
declare function getDbAdapter(): import('../../../services/promo-code.service').DbAdapter;
declare function getOrganizerIdFromToken(token: string): string | null;

const service = new PromoCodeService();

// ─── Zod schema for creation ──────────────────────────────────────────────────

const CreatePromoCodeSchema = z.object({
  code: z
    .string()
    .min(4)
    .max(20)
    .regex(/^[A-Z0-9]+$/i)
    .optional(),
  type: z.enum(['percentage', 'fixed', 'bogo', 'free']),
  discount_value: z.number().int().nonnegative(),
  max_uses: z.number().int().positive().nullable().default(null),
  max_uses_per_user: z.number().int().positive().nullable().default(null),
  valid_from: z.coerce.date(),
  valid_until: z.coerce.date().nullable().default(null),
  min_quantity: z.number().int().nonnegative().default(1),
  min_order_amount: z.number().int().nonnegative().default(0),
  applicable_ticket_type_ids: z.array(z.string().min(1)).nullable().default(null),
  applicable_event_ids: z.array(z.string().min(1)).nullable().default(null),
  stackable: z.boolean().default(false),
  active: z.boolean().default(true),
});

// ─── Auth helper ──────────────────────────────────────────────────────────────

function extractOrganizerId(request: NextRequest): string | null {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  return getOrganizerIdFromToken(token);
}

// ─── GET /api/promo-codes ─────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const organizerId = extractOrganizerId(request);
  if (!organizerId) {
    return NextResponse.json({ error: 'Neautorizováno' }, { status: 401 });
  }

  try {
    const db = getDbAdapter();
    const codes = await service.listOrganizerCodes(organizerId, db);
    return NextResponse.json(codes);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Interní chyba serveru';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── POST /api/promo-codes ────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const organizerId = extractOrganizerId(request);
  if (!organizerId) {
    return NextResponse.json({ error: 'Neautorizováno' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatné JSON tělo požadavku' }, { status: 400 });
  }

  const parsed = CreatePromoCodeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Neplatný formát požadavku', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Extra: validate discount_value range for percentage type
  const data = parsed.data;
  if (data.type === 'percentage' && (data.discount_value < 0 || data.discount_value > 100)) {
    return NextResponse.json(
      { error: 'Procentuální sleva musí být v rozsahu 0–100' },
      { status: 400 },
    );
  }

  try {
    const db = getDbAdapter();
    const code = await service.createPromoCode(data, organizerId, db);
    return NextResponse.json(code, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Interní chyba serveru';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
