/**
 * GET /api/platform/incidents — master admin list (all visibility)
 * POST /api/platform/incidents — vytvoření nového incidentu
 *
 * Auth: requirePlatformAdmin.
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

const CreateSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']),
  severity: z.enum(['minor', 'major', 'critical']).default('minor'),
  affectedServices: z.array(z.string()).max(20).default([]),
  isPublic: z.boolean().default(true),
});

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const r = await db().query(
    `SELECT id, title, description, status, severity, affected_services,
            is_public, started_at, resolved_at, created_at, updated_at
     FROM platform.incidents
     ORDER BY started_at DESC
     LIMIT 200`,
  );
  return NextResponse.json({ items: r.rows });
}

export async function POST(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const data = parsed.data;
  const resolvedAt = data.status === 'resolved' ? 'NOW()' : 'NULL';

  const r = await db().query<{ id: string }>(
    `INSERT INTO platform.incidents
       (title, description, status, severity, affected_services, is_public, resolved_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, ${resolvedAt}, $7)
     RETURNING id`,
    [
      data.title,
      data.description ?? null,
      data.status,
      data.severity,
      data.affectedServices,
      data.isPublic,
      admin.userId,
    ],
  );
  return NextResponse.json({ id: r.rows[0]!.id }, { status: 201 });
}
