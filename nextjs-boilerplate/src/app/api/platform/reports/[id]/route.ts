/**
 * PATCH /api/platform/reports/[id]
 *
 * Master admin přechod stavu DSA report:
 *   - status: 'pending' → 'reviewing' → 'resolved_action' | 'resolved_no_action' | 'dismissed_spam'
 *   - resolution_note: vysvětlení rozhodnutí (vyžadováno pro resolved_*)
 *   - action_taken: textový popis akce (např. „akce stažena z prodeje", „promotér suspendován")
 *
 * Pokud resolved_action a event_id → trigger event status='rejected' (volitelné).
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

const schema = z.object({
  status: z
    .enum(['reviewing', 'resolved_action', 'resolved_no_action', 'dismissed_spam'])
    .optional(),
  resolutionNote: z.string().max(5000).optional(),
  actionTaken: z.string().max(500).optional(),
  suspendEvent: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 422 });
  }
  const input = parsed.data;

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const r = await client.query<{ event_id: string | null; status: string }>(
      `SELECT event_id, status FROM audit.content_reports WHERE id = $1 FOR UPDATE`,
      [params.id],
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const isResolution = input.status?.startsWith('resolved_') || input.status === 'dismissed_spam';
    const reviewedFields = isResolution
      ? ', reviewed_at = NOW(), reviewed_by = $4'
      : '';
    const params2: unknown[] = [params.id, input.status ?? r.rows[0].status];
    let sql = `UPDATE audit.content_reports
               SET status = $2`;
    let pi = 3;
    if (input.resolutionNote !== undefined) {
      sql += `, resolution_note = $${pi++}`;
      params2.push(input.resolutionNote);
    }
    if (input.actionTaken !== undefined) {
      sql += `, action_taken = $${pi++}`;
      params2.push(input.actionTaken);
    }
    sql += reviewedFields;
    if (isResolution) params2.push(admin.userId);
    sql += `, updated_at = NOW() WHERE id = $1`;

    await client.query(sql, params2);

    // Pokud resolved_action + suspendEvent → status='rejected' na event
    if (
      input.status === 'resolved_action' &&
      input.suspendEvent &&
      r.rows[0].event_id
    ) {
      await client.query(
        `UPDATE catalog.events SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
        [r.rows[0].event_id],
      );
      await client.query(
        `INSERT INTO audit.event_moderation_log
           (event_id, actor_user_id, actor_type, decision, reason)
         VALUES ($1, $2, 'platform_admin', 'rejected', $3)`,
        [r.rows[0].event_id, admin.userId, `DSA report ${params.id}: ${input.actionTaken ?? 'content removed'}`],
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PATCH /api/platform/reports/[id]]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
