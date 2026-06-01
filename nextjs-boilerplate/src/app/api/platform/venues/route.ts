/**
 * GET  /api/platform/venues — list all venues (master admin sees draft + published + archived)
 * POST /api/platform/venues — create venue
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

const createSchema = z.object({
  name: z.string().min(2).max(200),
  venueType: z.enum(VENUE_TYPES).default('venue'),
  city: z.string().min(1).max(120),
  country: z.string().length(2).default('CZ'),
  address: z.string().max(500).optional(),
  capacity: z.number().int().min(1).max(500_000),
  gpsLat: z.number().min(-90).max(90).optional(),
  gpsLng: z.number().min(-180).max(180).optional(),
  photoUrl: z.string().url().max(500).optional(),
  floorPlanUrl: z.string().url().max(500).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async (_admin) => {
  const url = req.nextUrl;
  const status = url.searchParams.get('status');
  const search = url.searchParams.get('q');

  const conditions: string[] = ['v.archived_at IS NULL OR $1::text = $1::text'];
  const args: unknown[] = ['allow_all_by_dummy'];
  if (status) {
    args.push(status);
    conditions[0] = `v.status = $${args.length}`;
  }
  if (search) {
    args.push(`%${search}%`);
    conditions.push(`(v.name ILIKE $${args.length} OR v.city ILIKE $${args.length})`);
  }

  const r = await db().query<{
    id: string;
    name: string;
    venue_type: string;
    city: string;
    country: string;
    address: string | null;
    capacity: number;
    status: string;
    photo_url: string | null;
    last_modified_at: string;
    last_modifier_email: string | null;
    has_seating_chart: boolean;
    chart_thumbnail: unknown;
  }>(
    // chart_thumbnail = lehká reprezentace aktivního chartu pro list mini-preview:
    // { viewBox, stage_position, sectors: [{ name, color, seat_count }] }.
    // Bez plného layoutu (sedadla per coordinates) — to by bylo MB dat při 200 venues.
    // Pro skutečný full preview má venue detail samostatný /seating-chart endpoint.
    `SELECT v.id, v.name, v.venue_type, v.city, v.country, v.address, v.capacity,
            v.status, v.photo_url, v.last_modified_at,
            u.email AS last_modifier_email,
            EXISTS (SELECT 1 FROM catalog.venue_seating_charts WHERE venue_id = v.id AND active = true) AS has_seating_chart,
            (
              SELECT jsonb_build_object(
                'viewBox', layout->>'viewBox',
                'stage', layout->'stage',
                'sectors', (
                  SELECT jsonb_agg(jsonb_build_object(
                    'name', sec->>'name',
                    'color', sec->>'color',
                    'seats', sec->'rows'
                  ))
                  FROM jsonb_array_elements(layout->'sectors') sec
                )
              )
              FROM catalog.venue_seating_charts
              WHERE venue_id = v.id AND active = true
              LIMIT 1
            ) AS chart_thumbnail
     FROM catalog.venues v
     LEFT JOIN identity.users u ON u.id = v.last_modified_by_user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY v.last_modified_at DESC
     LIMIT 200`,
    args,
  );
  return NextResponse.json({ venues: r.rows });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async (admin) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const d = parsed.data;
  const r = await db().query<{ id: string }>(
    `INSERT INTO catalog.venues
       (name, venue_type, city, country, address, capacity,
        gps_lat, gps_lng, photo_url, floor_plan_url, description,
        status, last_modified_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      d.name,
      d.venueType,
      d.city,
      d.country.toUpperCase(),
      d.address ?? null,
      d.capacity,
      d.gpsLat ?? null,
      d.gpsLng ?? null,
      d.photoUrl ?? null,
      d.floorPlanUrl ?? null,
      d.description ?? null,
      d.status,
      admin.userId,
    ],
  );
  const reqCtx = extractRequestContext(req);
  void logAction({
    actorUserId: admin.userId,
    actorRole: 'platform_admin',
    action: 'venue.create',
    targetType: 'venue',
    targetId: r.rows[0].id,
    metadata: { name: d.name, capacity: d.capacity, status: d.status },
    ip: reqCtx.ip,
    userAgent: reqCtx.userAgent,
  });

  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });

  });
}
