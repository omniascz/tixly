/**
 * GET  /api/admin/pos/terminals  — seznam terminálů promotéra
 * POST /api/admin/pos/terminals  — vytvoří nový terminál
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (ctx) => {
    const rows = await db().query<{
      id: string;
      name: string;
      printer_type: string;
      printer_ip: string | null;
      printer_port: number;
      paper_width_mm: number;
      is_active: boolean;
      created_at: string;
    }>(
      `SELECT id, name, printer_type, printer_ip, printer_port, paper_width_mm, is_active, created_at
       FROM platform.pos_terminals
       WHERE promoter_id = $1
       ORDER BY created_at DESC`,
      [ctx.promoterId],
    );

    return NextResponse.json({ terminals: rows.rows });
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  printerType: z.enum(['zebra', 'boca', 'generic']).default('zebra'),
  printerIp: z.string().max(45).optional(),
  printerPort: z.number().int().min(1).max(65535).default(9100).optional(),
  paperWidthMm: z.number().int().min(50).max(200).default(104).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (ctx) => {
    const body = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { name, printerType, printerIp, printerPort, paperWidthMm } = parsed.data;

    const result = await db().query<{ id: string }>(
      `INSERT INTO platform.pos_terminals
         (promoter_id, name, printer_type, printer_ip, printer_port, paper_width_mm)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        ctx.promoterId,
        name,
        printerType,
        printerIp ?? null,
        printerPort ?? 9100,
        paperWidthMm ?? 104,
      ],
    );

    return NextResponse.json({ id: result.rows[0].id }, { status: 201 });
  });
}
