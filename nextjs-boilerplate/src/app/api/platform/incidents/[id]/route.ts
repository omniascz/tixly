/**
 * GET    /api/platform/incidents/[id] — single + updates timeline
 * PATCH  /api/platform/incidents/[id] — update status/title/severity/public
 * DELETE /api/platform/incidents/[id] — remove (cascade removes updates)
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

const PatchSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']).optional(),
  severity: z.enum(['minor', 'major', 'critical']).optional(),
  affectedServices: z.array(z.string()).max(20).optional(),
  isPublic: z.boolean().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }
  const incident = await db().query(
    `SELECT id, title, description, status, severity, affected_services,
            is_public, started_at, resolved_at, created_at, updated_at
     FROM platform.incidents WHERE id = $1`,
    [id],
  );
  if (incident.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const updates = await db().query(
    `SELECT id, status, message, created_at
     FROM platform.incident_updates
     WHERE incident_id = $1
     ORDER BY created_at DESC`,
    [id],
  );
  return NextResponse.json({
    incident: incident.rows[0],
    updates: updates.rows,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid', issues: parsed.error.issues }, { status: 422 });
  }
  const d = parsed.data;
  const sets: string[] = ['updated_at = NOW()'];
  const args: unknown[] = [];
  let p = 1;
  if (d.title !== undefined) {
    sets.push(`title = $${p++}`);
    args.push(d.title);
  }
  if (d.description !== undefined) {
    sets.push(`description = $${p++}`);
    args.push(d.description);
  }
  if (d.status !== undefined) {
    sets.push(`status = $${p++}`);
    args.push(d.status);
    if (d.status === 'resolved') {
      sets.push(`resolved_at = COALESCE(resolved_at, NOW())`);
    } else {
      sets.push(`resolved_at = NULL`);
    }
  }
  if (d.severity !== undefined) {
    sets.push(`severity = $${p++}`);
    args.push(d.severity);
  }
  if (d.affectedServices !== undefined) {
    sets.push(`affected_services = $${p++}`);
    args.push(d.affectedServices);
  }
  if (d.isPublic !== undefined) {
    sets.push(`is_public = $${p++}`);
    args.push(d.isPublic);
  }
  args.push(id);
  await db().query(
    `UPDATE platform.incidents SET ${sets.join(', ')} WHERE id = $${p}`,
    args,
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }
  await db().query(`DELETE FROM platform.incidents WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
