/**
 * POST /api/platform/incidents/[id]/updates — přidá entry do timeline.
 * Tělo zprávy + status. Automaticky updatuje incident.status na poslední update.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const Schema = z.object({
  status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']),
  message: z.string().min(3).max(1000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid', issues: parsed.error.issues }, { status: 422 });
  }

  await db().query(
    `INSERT INTO platform.incident_updates (incident_id, status, message, created_by)
     VALUES ($1, $2, $3, $4)`,
    [id, parsed.data.status, parsed.data.message, admin.userId],
  );

  const resolvedAt = parsed.data.status === 'resolved' ? 'NOW()' : 'NULL';
  await db().query(
    `UPDATE platform.incidents
     SET status = $1, updated_at = NOW(),
         resolved_at = COALESCE(resolved_at, ${resolvedAt})
     WHERE id = $2`,
    [parsed.data.status, id],
  );

  return NextResponse.json({ ok: true }, { status: 201 });
}
