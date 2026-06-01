/**
 * GET   /api/platform/reports?status=pending  — master admin queue
 * PATCH /api/platform/reports/[id]            — assign / resolve
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';


export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async (_admin) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'pending';

  const r = await db().query<{
    id: string;
    event_id: string | null;
    promoter_id: string | null;
    reported_url: string | null;
    category: string;
    reason: string;
    priority: string;
    status: string;
    reporter_email: string | null;
    reporter_ip: string;
    created_at: string;
    reviewed_at: string | null;
    resolution_note: string | null;
    action_taken: string | null;
    event_title: string | null;
    promoter_name: string | null;
  }>(
    `SELECT cr.id, cr.event_id, cr.promoter_id, cr.reported_url, cr.category, cr.reason,
            cr.priority, cr.status, cr.reporter_email, cr.reporter_ip, cr.created_at,
            cr.reviewed_at, cr.resolution_note, cr.action_taken,
            e.title AS event_title,
            p.name AS promoter_name
     FROM audit.content_reports cr
     LEFT JOIN catalog.events e ON e.id = cr.event_id
     LEFT JOIN platform.promoters p ON p.id = COALESCE(cr.promoter_id, e.promoter_id)
     WHERE ($1 = 'all' OR cr.status = $1)
     ORDER BY
       CASE cr.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       cr.created_at DESC
     LIMIT 200`,
    [status],
  );

  return NextResponse.json({
    items: r.rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      promoterId: row.promoter_id,
      reportedUrl: row.reported_url,
      category: row.category,
      reason: row.reason,
      priority: row.priority,
      status: row.status,
      reporterEmail: row.reporter_email,
      reporterIp: row.reporter_ip,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      resolutionNote: row.resolution_note,
      actionTaken: row.action_taken,
      eventTitle: row.event_title,
      promoterName: row.promoter_name,
    })),
  });

  });
}
