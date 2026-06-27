/**
 * PATCH  /api/admin/scanner/devices/[deviceId] — toggle active / rename
 * DELETE /api/admin/scanner/devices/[deviceId] — revoke device
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

async function ensureOwnership(deviceId: string, promoterId: string): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM catalog.scanner_devices WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
    [deviceId, promoterId],
  );
  return r.rows.length > 0;
}

const patchSchema = z.object({
  active: z.boolean().optional(),
  name: z.string().min(1).max(120).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { deviceId: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ensureOwnership(params.deviceId, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
    }
    const d = parsed.data;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (d.active !== undefined) { sets.push(`active = $${idx++}`); vals.push(d.active); }
    if (d.name !== undefined) { sets.push(`name = $${idx++}`); vals.push(d.name); }
    if (sets.length === 0) return NextResponse.json({ ok: true });
    vals.push(params.deviceId);
    await db().query(
      `UPDATE catalog.scanner_devices SET ${sets.join(', ')} WHERE id = $${idx}`,
      vals,
    );
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { deviceId: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ensureOwnership(params.deviceId, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await db().query(`DELETE FROM catalog.scanner_devices WHERE id = $1`, [params.deviceId]);
    return NextResponse.json({ ok: true });
  });
}
