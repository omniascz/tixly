/**
 * GET  /api/admin/scanner/devices — list scanner devices pro promotéra
 * POST /api/admin/scanner/devices — create nový device + vygenerovat API klíč
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

interface DeviceRow {
  id: string;
  name: string;
  description: string | null;
  api_key: string;
  event_id: string | null;
  event_title: string | null;
  gate_id: string | null;
  gate_label: string | null;
  zone_id: string | null;
  zone_name: string | null;
  active: boolean;
  last_seen_at: string | null;
  created_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const r = await db().query<DeviceRow>(
      `SELECT d.id, d.name, d.description, d.api_key, d.event_id,
              e.title AS event_title, d.gate_id, vg.label AS gate_label,
              d.zone_id, ez.name AS zone_name,
              d.active, d.last_seen_at::text, d.created_at::text
       FROM catalog.scanner_devices d
       LEFT JOIN catalog.events e ON e.id = d.event_id
       LEFT JOIN catalog.venue_gates vg ON vg.id = d.gate_id
       LEFT JOIN catalog.event_zones ez ON ez.id = d.zone_id
       WHERE d.promoter_id = $1
       ORDER BY d.created_at DESC`,
      [promoter.promoterId],
    );
    return NextResponse.json({
      devices: r.rows.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        apiKey: d.api_key,
        eventId: d.event_id,
        eventTitle: d.event_title,
        gateId: d.gate_id,
        gateLabel: d.gate_label,
        zoneId: d.zone_id,
        zoneName: d.zone_name,
        active: d.active,
        lastSeenAt: d.last_seen_at,
        createdAt: d.created_at,
      })),
    });
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  eventId: z.string().uuid().optional(),
  gateId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
    }
    const d = parsed.data;
    // Device API key: "tixly_dev_" + 32 bytes hex = 74 chars total
    const apiKey = `tixly_dev_${randomBytes(32).toString('hex')}`;

    const r = await db().query<{ id: string }>(
      `INSERT INTO catalog.scanner_devices
         (promoter_id, name, description, api_key, event_id, gate_id, zone_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        promoter.promoterId,
        d.name,
        d.description ?? null,
        apiKey,
        d.eventId ?? null,
        d.gateId ?? null,
        d.zoneId ?? null,
      ],
    );
    return NextResponse.json({ id: r.rows[0].id, apiKey }, { status: 201 });
  });
}
