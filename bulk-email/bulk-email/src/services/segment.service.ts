import type { ServiceDeps } from '../lib/service-container.js';
import { BulkEmailError } from '../lib/bulk-email-errors.js';
import type { SegmentFilter } from '../types/bulk-email.js';

export interface ResolvedRecipient {
  clientId: string;
  email: string;
  firstName: string;
}

/**
 * Resolve a segment filter to a list of recipients.
 * All queries are scoped by promoter_id and require an email + marketing_opt_in.
 */
export async function resolveSegment(
  promoterId: string,
  segment: SegmentFilter,
  deps: ServiceDeps,
): Promise<ResolvedRecipient[]> {
  const baseFilter = `c.promoter_id = $1
    AND c.email IS NOT NULL
    AND COALESCE(c.marketing_opt_in, FALSE) = TRUE`;

  let sql: string;
  let params: unknown[];

  switch (segment.type) {
    case 'all': {
      sql = `SELECT c.id AS client_id, c.email, COALESCE(c.first_name, '') AS first_name
             FROM platform.clients c
             WHERE ${baseFilter}`;
      params = [promoterId];
      break;
    }
    case 'active': {
      sql = `SELECT DISTINCT c.id AS client_id, c.email, COALESCE(c.first_name, '') AS first_name
             FROM platform.clients c
             JOIN ems.reservations r ON r.client_id = c.id
             JOIN ems.slots s ON s.id = r.slot_id
             WHERE ${baseFilter}
               AND s.starts_at >= NOW() - INTERVAL '30 days'`;
      params = [promoterId];
      break;
    }
    case 'dormant_30': {
      sql = `SELECT c.id AS client_id, c.email, COALESCE(c.first_name, '') AS first_name
             FROM platform.clients c
             WHERE ${baseFilter}
               AND NOT EXISTS (
                 SELECT 1 FROM ems.reservations r
                 JOIN ems.slots s ON s.id = r.slot_id
                 WHERE r.client_id = c.id
                   AND s.starts_at >= NOW() - INTERVAL '30 days'
               )`;
      params = [promoterId];
      break;
    }
    case 'has_active_package': {
      sql = `SELECT DISTINCT c.id AS client_id, c.email, COALESCE(c.first_name, '') AS first_name
             FROM platform.clients c
             JOIN permanentky.client_packages cp ON cp.client_id = c.id
             WHERE ${baseFilter}
               AND cp.status = 'active'
               AND cp.valid_until >= NOW()`;
      params = [promoterId];
      break;
    }
    case 'no_active_package': {
      sql = `SELECT c.id AS client_id, c.email, COALESCE(c.first_name, '') AS first_name
             FROM platform.clients c
             WHERE ${baseFilter}
               AND NOT EXISTS (
                 SELECT 1 FROM permanentky.client_packages cp
                 WHERE cp.client_id = c.id
                   AND cp.status = 'active'
                   AND cp.valid_until >= NOW()
               )`;
      params = [promoterId];
      break;
    }
    case 'tag': {
      const tags = (segment.params?.tags as string[]) ?? segment.tags ?? [];
      if (!Array.isArray(tags) || tags.length === 0) {
        throw new BulkEmailError('INVALID_SEGMENT', 'Tag segment vyžaduje alespoň jeden tag');
      }
      sql = `SELECT c.id AS client_id, c.email, COALESCE(c.first_name, '') AS first_name
             FROM platform.clients c
             WHERE ${baseFilter}
               AND c.tags @> $2::text[]`;
      params = [promoterId, tags];
      break;
    }
    default:
      throw new BulkEmailError('INVALID_SEGMENT', `Neznámý typ segmentu: ${segment.type}`);
  }

  const rows = await deps.db.query<{
    client_id: string;
    email: string;
    first_name: string;
  }>(sql, params);

  return rows.map((r) => ({
    clientId: r.client_id,
    email: r.email,
    firstName: r.first_name,
  }));
}
