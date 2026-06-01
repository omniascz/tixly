/**
 * GET /api/platform/incidents — master admin list (all visibility)
 * POST /api/platform/incidents — vytvoření nového incidentu
 *
 * Auth: requirePlatformAdmin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';
import { z } from 'zod';


const CreateSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']),
  severity: z.enum(['minor', 'major', 'critical']).default('minor'),
  affectedServices: z.array(z.string()).max(20).default([]),
  isPublic: z.boolean().default(true),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async (_admin) => {
  const r = await db().query(
    `SELECT id, title, description, status, severity, affected_services,
            is_public, started_at, resolved_at, created_at, updated_at
     FROM platform.incidents
     ORDER BY started_at DESC
     LIMIT 200`,
  );
  return NextResponse.json({ items: r.rows });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async (admin) => {
  const body: unknown = await req.json().catch(() => null);
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
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });

  });
}
