/**
 * Unified audit log helper. Voláno z admin endpointů pro every state-changing action.
 *
 * Best-effort: pokud DB write selže, jen logne — nikdy neblockuje original request.
 */

import type { NextRequest } from 'next/server';
import { db } from '@/lib/db/rls-pool';


export interface AuditContext {
  actorUserId?: string | null;
  actorRole?: string | null;
  promoterId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export async function logAction(ctx: AuditContext): Promise<void> {
  try {
    await db().query(
      `INSERT INTO audit.platform_log
         (actor_user_id, actor_role, promoter_id, action, target_type, target_id,
          metadata, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        ctx.actorUserId ?? null,
        ctx.actorRole ?? null,
        ctx.promoterId ?? null,
        ctx.action,
        ctx.targetType ?? null,
        ctx.targetId ?? null,
        JSON.stringify(ctx.metadata ?? {}),
        ctx.ip ?? null,
        ctx.userAgent ?? null,
      ],
    );
  } catch (err) {
    console.error('[audit log]', ctx.action, err);
  }
}

export function extractRequestContext(req: NextRequest): {
  ip: string | null;
  userAgent: string | null;
  actorUserId: string | null;
} {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
    actorUserId: req.headers.get('x-user-id'),
  };
}
