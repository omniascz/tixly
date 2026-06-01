/**
 * GET    /api/platform/venues/[id] — single venue detail
 * PATCH  /api/platform/venues/[id] — partial update (master admin only)
 * DELETE /api/platform/venues/[id] — soft delete (sets archived_at)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';
import { z } from 'zod';
import { logAction, extractRequestContext } from '@/lib/audit/log';


const VENUE_TYPES = [
  'venue', 'stadium', 'arena', 'cinema_hall', 'theatre_hall', 'club',
  'outdoor', 'fitness_studio', 'restaurant', 'coworking', 'conference_room', 'online',
] as const;

const patchSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  venueType: z.enum(VENUE_TYPES).optional(),
  city: z.string().min(1).max(120).optional(),
  country: z.string().length(2).optional(),
  address: z.string().max(500).nullable().optional(),
  capacity: z.number().int().min(1).max(500_000).optional(),
  gpsLat: z.number().min(-90).max(90).nullable().optional(),
  gpsLng: z.number().min(-180).max(180).nullable().optional(),
  photoUrl: z.string().url().max(500).nullable().optional(),
  floorPlanUrl: z.string().url().max(500).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});

const COLUMN_MAP: Record<string, string> = {
  name: 'name',
  venueType: 'venue_type',
  city: 'city',
  country: 'country',
  address: 'address',
  capacity: 'capacity',
  gpsLat: 'gps_lat',
  gpsLng: 'gps_lng',
  photoUrl: 'photo_url',
  floorPlanUrl: 'floor_plan_url',
  description: 'description',
  status: 'status',
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPlatformAdmin(req, async (_admin) => {
  const r = await db().query<Record<string, unknown>>(
    `SELECT v.id, v.name, v.venue_type, v.city, v.country, v.address, v.capacity,
            v.gps_lat, v.gps_lng, v.photo_url, v.floor_plan_url, v.description,
            v.status, v.archived_at, v.created_at, v.last_modified_at,
            v.last_modified_by_user_id,
            u.email AS last_modifier_email,
            (SELECT COUNT(*)::int FROM catalog.venue_seating_charts
              WHERE venue_id = v.id) AS seating_chart_count,
            EXISTS (SELECT 1 FROM catalog.venue_seating_charts
              WHERE venue_id = v.id AND active = true) AS has_active_seating_chart,
            (SELECT COUNT(*)::int FROM catalog.events
              WHERE venue_id = v.id AND date_start > NOW()) AS upcoming_events_count
     FROM catalog.venues v
     LEFT JOIN identity.users u ON u.id = v.last_modified_by_user_id
     WHERE v.id = $1`,
    [params.id],
  );
  if (!r.rows.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ venue: r.rows[0] });

  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPlatformAdmin(req, async (admin) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const updates = parsed.data;
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    const col = COLUMN_MAP[key];
    if (!col) continue;
    args.push(key === 'country' && typeof value === 'string' ? value.toUpperCase() : value);
    sets.push(`${col} = $${args.length}`);
  }
  if (!sets.length) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 422 });
  }
  args.push(admin.userId);
  sets.push(`last_modified_by_user_id = $${args.length}`);
  sets.push(`last_modified_at = NOW()`);
  args.push(params.id);

  const r = await db().query<{ id: string }>(
    `UPDATE catalog.venues SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING id`,
    args,
  );
  if (!r.rows.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const reqCtx = extractRequestContext(req);
  void logAction({
    actorUserId: admin.userId,
    actorRole: 'platform_admin',
    action: 'venue.update',
    targetType: 'venue',
    targetId: params.id,
    metadata: { fields: Object.keys(updates) },
    ip: reqCtx.ip,
    userAgent: reqCtx.userAgent,
  });

  return NextResponse.json({ id: r.rows[0].id });

  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPlatformAdmin(req, async (admin) => {
  const usage = await db().query<{ upcoming: number }>(
    `SELECT COUNT(*)::int AS upcoming FROM catalog.events
      WHERE venue_id = $1 AND date_start > NOW() AND status <> 'archived'`,
    [params.id],
  );
  if ((usage.rows[0]?.upcoming ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Cannot archive: venue has upcoming events', upcomingEvents: usage.rows[0].upcoming },
      { status: 409 },
    );
  }

  const r = await db().query<{ id: string }>(
    `UPDATE catalog.venues
        SET archived_at = NOW(),
            status = 'archived',
            last_modified_by_user_id = $1,
            last_modified_at = NOW()
      WHERE id = $2 AND archived_at IS NULL
      RETURNING id`,
    [admin.userId, params.id],
  );
  if (!r.rows.length) {
    return NextResponse.json({ error: 'Not found or already archived' }, { status: 404 });
  }

  const reqCtx = extractRequestContext(req);
  void logAction({
    actorUserId: admin.userId,
    actorRole: 'platform_admin',
    action: 'venue.archive',
    targetType: 'venue',
    targetId: params.id,
    ip: reqCtx.ip,
    userAgent: reqCtx.userAgent,
  });

  return NextResponse.json({ id: r.rows[0].id, archived: true });

  });
}
