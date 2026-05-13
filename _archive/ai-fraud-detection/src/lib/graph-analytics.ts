// =============================================================================
// Graph analytics — lightweight SQL-backed user graph traversal
//
// The "graph" is the set of users connected by shared identifiers:
//   shared_device   — same device_fingerprints.fingerprint_hash
//   shared_card     — same payments.card_fingerprint
//   shared_phone    — same accounts.users.phone_hash
//   shared_address  — same accounts.users.address_hash
//
// Graph traversal is bounded by maxHops and maxNodes so a toxic ring doesn't
// blow up the query budget.
// =============================================================================

import type { ServiceDeps } from './service-container.js';

export interface UserConnection {
  fromUserId: string;
  toUserId: string;
  /** Shared signals: shared_device, shared_card, shared_address, shared_phone */
  signals: string[];
  strength: number; // 0-1
}

export interface UserCluster {
  id: string;
  userIds: string[];
  /** Anomaly signals at the cluster level */
  flags: string[];
  /** How many shared signals across the cluster */
  cohesion: number;
}

const MAX_NODES = 100;
const SIGNAL_STRENGTH: Record<string, number> = {
  shared_device: 0.35,
  shared_card: 0.45,
  shared_phone: 0.15,
  shared_address: 0.15,
};

interface NeighborRow {
  other_user_id: string;
  signals: string[];
}

async function directNeighbors(userId: string, deps: ServiceDeps): Promise<NeighborRow[]> {
  // Single UNION query returning any user sharing at least one identifier.
  const rows = await deps.db.query<{ other_user_id: string; signal: string }>(
    `SELECT DISTINCT df2.user_id::text AS other_user_id, 'shared_device'::text AS signal
       FROM risk.device_fingerprints df1
       JOIN risk.device_fingerprints df2
         ON df2.fingerprint_hash = df1.fingerprint_hash AND df2.user_id <> df1.user_id
       WHERE df1.user_id = $1 AND df2.user_id IS NOT NULL
     UNION
     SELECT DISTINCT o2.user_id::text AS other_user_id, 'shared_card'::text AS signal
       FROM payments.payments p1
       JOIN orders.orders o1 ON o1.id = p1.order_id
       JOIN payments.payments p2 ON p2.card_fingerprint = p1.card_fingerprint
       JOIN orders.orders o2 ON o2.id = p2.order_id AND o2.user_id <> o1.user_id
       WHERE o1.user_id = $1
     UNION
     SELECT DISTINCT u2.id::text AS other_user_id, 'shared_phone'::text AS signal
       FROM accounts.users u1
       JOIN accounts.users u2 ON u2.phone_hash = u1.phone_hash AND u2.id <> u1.id
       WHERE u1.id = $1 AND u1.phone_hash IS NOT NULL
     UNION
     SELECT DISTINCT u2.id::text AS other_user_id, 'shared_address'::text AS signal
       FROM accounts.users u1
       JOIN accounts.users u2 ON u2.address_hash = u1.address_hash AND u2.id <> u1.id
       WHERE u1.id = $1 AND u1.address_hash IS NOT NULL`,
    [userId],
  );

  // Merge signals per neighbor
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.other_user_id)) map.set(r.other_user_id, new Set());
    map.get(r.other_user_id)!.add(r.signal);
  }
  return Array.from(map.entries()).map(([other_user_id, set]) => ({
    other_user_id,
    signals: Array.from(set),
  }));
}

function computeStrength(signals: string[]): number {
  let s = 0;
  for (const sig of signals) s += SIGNAL_STRENGTH[sig] ?? 0;
  return Math.min(1, s);
}

/**
 * BFS outward from subjectUserId. Returns edges discovered, stopping when we
 * exceed maxHops or visit more than MAX_NODES nodes.
 */
export async function findConnectedUsers(
  subjectUserId: string,
  maxHops: number,
  deps: ServiceDeps,
): Promise<UserConnection[]> {
  const visited = new Set<string>([subjectUserId]);
  const edges: UserConnection[] = [];
  let frontier: string[] = [subjectUserId];

  for (let hop = 0; hop < maxHops && visited.size < MAX_NODES; hop++) {
    const next: string[] = [];
    for (const u of frontier) {
      if (visited.size >= MAX_NODES) break;
      const neighbors = await directNeighbors(u, deps);
      for (const n of neighbors) {
        edges.push({
          fromUserId: u,
          toUserId: n.other_user_id,
          signals: n.signals,
          strength: computeStrength(n.signals),
        });
        if (!visited.has(n.other_user_id) && visited.size < MAX_NODES) {
          visited.add(n.other_user_id);
          next.push(n.other_user_id);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return edges;
}

/**
 * Finds tight rings on a promoter: groups of 3+ users sharing a device
 * fingerprint and all having made purchases with that promoter.
 */
export async function findUserClusters(
  promoterId: string,
  deps: ServiceDeps,
): Promise<UserCluster[]> {
  const rows = await deps.db.query<{
    fingerprint_hash: string;
    user_ids: string[];
    user_count: number;
  }>(
    `SELECT df.fingerprint_hash,
            ARRAY_AGG(DISTINCT df.user_id::text) AS user_ids,
            COUNT(DISTINCT df.user_id)::int AS user_count
     FROM risk.device_fingerprints df
     JOIN orders.orders o ON o.user_id = df.user_id
     WHERE o.promoter_id = $1
       AND df.user_id IS NOT NULL
       AND df.seen_at > NOW() - INTERVAL '30 days'
     GROUP BY df.fingerprint_hash
     HAVING COUNT(DISTINCT df.user_id) >= 3`,
    [promoterId],
  );

  return rows.map((r) => {
    const flags: string[] = ['shared_device'];
    if (r.user_count >= 5) flags.push('potential_ring');
    return {
      id: r.fingerprint_hash,
      userIds: r.user_ids,
      flags,
      cohesion: r.user_count,
    };
  });
}
