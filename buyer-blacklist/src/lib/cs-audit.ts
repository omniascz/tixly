/**
 * CS audit log helper.
 *
 * Records customer-support / admin actions on blacklist entries.
 * Backing table: blacklist.cs_actions
 *   id UUID PK, actor_id UUID, actor_role TEXT,
 *   action TEXT, target_entry_id UUID NULL, payload JSONB, created_at TIMESTAMPTZ
 */

import type { DbAdapter, UserRole } from '../types/blacklist.types.js';

export type CsActionType =
  | 'entry.created'
  | 'entry.removed'
  | 'entry.overridden'
  | 'entry.imported'
  | 'entry.exported'
  | 'appeal.reviewed';

export interface CsAuditRecord {
  actorId: string;
  actorRole: UserRole;
  action: CsActionType;
  targetEntryId?: string | null;
  payload?: Record<string, unknown>;
}

export async function recordCsAction(
  db: Pick<DbAdapter, 'query'>,
  rec: CsAuditRecord,
): Promise<void> {
  await db.query(
    `INSERT INTO blacklist.cs_actions
       (actor_id, actor_role, action, target_entry_id, payload, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
    [
      rec.actorId,
      rec.actorRole,
      rec.action,
      rec.targetEntryId ?? null,
      JSON.stringify(rec.payload ?? {}),
    ],
  );
}
