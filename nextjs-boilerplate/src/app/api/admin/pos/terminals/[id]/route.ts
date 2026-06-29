/**
 * PATCH  /api/admin/pos/terminals/[id]  — update terminál
 * DELETE /api/admin/pos/terminals/[id]  — smazat terminál
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  printerType: z.enum(['zebra', 'boca', 'generic']).optional(),
  printerIp: z.string().max(45).nullable().optional(),
  printerPort: z.number().int().min(1).max(65535).optional(),
  paperWidthMm: z.number().int().min(50).max(200).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return runAsActivePromoter(req, async (ctx) => {
    const body = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const d = parsed.data;

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (d.name !== undefined) { updates.push(`name = $${idx++}`); values.push(d.name); }
    if (d.printerType !== undefined) { updates.push(`printer_type = $${idx++}`); values.push(d.printerType); }
    if (d.printerIp !== undefined) { updates.push(`printer_ip = $${idx++}`); values.push(d.printerIp); }
    if (d.printerPort !== undefined) { updates.push(`printer_port = $${idx++}`); values.push(d.printerPort); }
    if (d.paperWidthMm !== undefined) { updates.push(`paper_width_mm = $${idx++}`); values.push(d.paperWidthMm); }
    if (d.isActive !== undefined) { updates.push(`is_active = $${idx++}`); values.push(d.isActive); }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 400 });
    }

    values.push(id);
    values.push(ctx.promoterId);

    const result = await db().query<{ id: string }>(
      `UPDATE platform.pos_terminals
       SET ${updates.join(', ')}
       WHERE id = $${idx} AND promoter_id = $${idx + 1}
       RETURNING id`,
      values,
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'TERMINAL_NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return runAsActivePromoter(req, async (ctx) => {
    const result = await db().query<{ id: string }>(
      `DELETE FROM platform.pos_terminals
       WHERE id = $1 AND promoter_id = $2
       RETURNING id`,
      [id, ctx.promoterId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'TERMINAL_NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
