/**
 * GET/PATCH /api/admin/events/[id]/hot-mode
 *
 * Eventim Pass-style hot event configuration.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const patchSchema = z.object({
  hotEventMode: z.boolean().optional(),
  maxTicketsPerBuyer: z.number().int().min(1).max(50).nullable().optional(),
  qrRevealMinutesBefore: z.number().int().min(0).max(43200).optional(), // max 30 dní
  requireTanValidation: z.boolean().optional(),
  requirePhoneBinding: z.boolean().optional(),
  noGiftingMode: z.boolean().optional(),
  requirePhotoId: z.boolean().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { id: eventId } = await params;

  const r = await db().query<{
    hot_event_mode: boolean;
    max_tickets_per_buyer: number | null;
    qr_reveal_minutes_before: number;
    require_tan_validation: boolean;
    require_phone_binding: boolean;
    no_gifting_mode: boolean;
    require_photo_id: boolean;
  }>(
    `SELECT hot_event_mode, max_tickets_per_buyer, qr_reveal_minutes_before,
            require_tan_validation, require_phone_binding,
            no_gifting_mode, require_photo_id
       FROM catalog.events
      WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoter.promoterId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json(r.rows[0]);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const { id: eventId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
  }
  const d = parsed.data;

  // Pokud hotEventMode = true, vynutit související flags
  const updates: string[] = [];
  const args: unknown[] = [eventId, promoter.promoterId];

  function addUpdate(col: string, val: unknown) {
    args.push(val);
    updates.push(`${col} = $${args.length}`);
  }

  if (d.hotEventMode !== undefined) {
    addUpdate('hot_event_mode', d.hotEventMode);
    if (d.hotEventMode) {
      // Auto-enable hardening if user turns on hot mode
      addUpdate('require_phone_binding', d.requirePhoneBinding ?? true);
      addUpdate('require_tan_validation', d.requireTanValidation ?? true);
      addUpdate('no_gifting_mode', d.noGiftingMode ?? true);
    } else {
      // Allow opt-in granularly when turning off
      if (d.requirePhoneBinding !== undefined) addUpdate('require_phone_binding', d.requirePhoneBinding);
      if (d.requireTanValidation !== undefined) addUpdate('require_tan_validation', d.requireTanValidation);
      if (d.noGiftingMode !== undefined) addUpdate('no_gifting_mode', d.noGiftingMode);
    }
  } else {
    if (d.requirePhoneBinding !== undefined) addUpdate('require_phone_binding', d.requirePhoneBinding);
    if (d.requireTanValidation !== undefined) addUpdate('require_tan_validation', d.requireTanValidation);
    if (d.noGiftingMode !== undefined) addUpdate('no_gifting_mode', d.noGiftingMode);
  }
  if (d.maxTicketsPerBuyer !== undefined) addUpdate('max_tickets_per_buyer', d.maxTicketsPerBuyer);
  if (d.qrRevealMinutesBefore !== undefined) addUpdate('qr_reveal_minutes_before', d.qrRevealMinutesBefore);
  if (d.requirePhotoId !== undefined) addUpdate('require_photo_id', d.requirePhotoId);

  if (updates.length === 0) {
    return NextResponse.json({ ok: true, noop: true });
  }

  const sql = `UPDATE catalog.events SET ${updates.join(', ')}
               WHERE id = $1 AND promoter_id = $2 RETURNING id`;
  const r = await db().query(sql, args);
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
