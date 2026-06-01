/**
 * Recommendation engine — co-occurrence + content fallback.
 *
 * Strategie:
 *   1. **Co-occurrence**: kupci event X koupili také Y (collaborative filtering)
 *      → "Lidé co koupili Coldplay si koupili také Imagine Dragons"
 *   2. **Content fallback**: stejná kategorie nebo venue, podobné období, podobná cena
 *      → pro "cold start" eventy bez kupců
 *
 * Cache: výsledky 30min v paměti per (eventId).
 */
import { db } from "@/lib/db/rls-pool";



interface CacheEntry {
  expires: number;
  events: Recommendation[];
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface Recommendation {
  id: string;
  title: string;
  date_start: string;
  venue_name: string | null;
  category: string;
  min_price: number | null;
  currency: string;
  reason: 'co_occurrence' | 'same_category' | 'same_venue' | 'similar_price';
  score: number;
}

export async function getRecommendations(
  eventId: string,
  limit = 6,
): Promise<Recommendation[]> {
  const cached = cache.get(eventId);
  if (cached && cached.expires > Date.now()) {
    return cached.events.slice(0, limit);
  }

  const out: Recommendation[] = [];
  const seenIds = new Set<string>([eventId]);

  // 1) Co-occurrence: kupci tohohle eventu koupili i…
  const coOccur = await db().query<{
    id: string;
    title: string;
    date_start: string;
    venue_name: string | null;
    category: string;
    min_price: string | null;
    currency: string;
    co_occur_count: string;
  }>(
    `SELECT e.id, e.title, e.date_start, v.name AS venue_name, e.category,
            (SELECT MIN(base_price)::text FROM catalog.ticket_types WHERE event_id = e.id) AS min_price,
            e.currency,
            COUNT(DISTINCT o2.user_id)::text AS co_occur_count
     FROM orders.orders o1
     JOIN orders.orders o2 ON o2.user_id = o1.user_id AND o2.event_id != o1.event_id
     JOIN catalog.events e ON e.id = o2.event_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     WHERE o1.event_id = $1
       AND o1.status IN ('paid', 'paid_partial')
       AND o2.status IN ('paid', 'paid_partial')
       AND e.status = 'published'
       AND e.date_start > NOW()
     GROUP BY e.id, v.name
     ORDER BY co_occur_count DESC
     LIMIT $2`,
    [eventId, limit * 2],
  );
  for (const r of coOccur.rows) {
    if (seenIds.has(r.id)) continue;
    seenIds.add(r.id);
    out.push({
      id: r.id,
      title: r.title,
      date_start: r.date_start,
      venue_name: r.venue_name,
      category: r.category,
      min_price: r.min_price !== null ? Number(r.min_price) : null,
      currency: r.currency,
      reason: 'co_occurrence',
      score: Math.min(1, Number(r.co_occur_count) / 10),
    });
  }

  // 2) Content fallback: same category/venue, future
  if (out.length < limit) {
    const remaining = limit - out.length;
    const ids = [...seenIds];
    const fallback = await db().query<{
      id: string;
      title: string;
      date_start: string;
      venue_name: string | null;
      category: string;
      min_price: string | null;
      currency: string;
      same_venue: boolean;
      same_category: boolean;
    }>(
      `WITH src AS (
         SELECT category, venue_id FROM catalog.events WHERE id = $1
       )
       SELECT e.id, e.title, e.date_start, v.name AS venue_name, e.category,
              (SELECT MIN(base_price)::text FROM catalog.ticket_types WHERE event_id = e.id) AS min_price,
              e.currency,
              (e.venue_id = src.venue_id) AS same_venue,
              (e.category = src.category) AS same_category
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       CROSS JOIN src
       WHERE e.status = 'published' AND e.date_start > NOW()
         AND NOT (e.id = ANY($2::uuid[]))
         AND (e.venue_id = src.venue_id OR e.category = src.category)
       ORDER BY same_venue DESC, same_category DESC, e.date_start ASC
       LIMIT $3`,
      [eventId, ids, remaining],
    );
    for (const r of fallback.rows) {
      out.push({
        id: r.id,
        title: r.title,
        date_start: r.date_start,
        venue_name: r.venue_name,
        category: r.category,
        min_price: r.min_price !== null ? Number(r.min_price) : null,
        currency: r.currency,
        reason: r.same_venue ? 'same_venue' : 'same_category',
        score: r.same_venue && r.same_category ? 0.7 : 0.5,
      });
    }
  }

  cache.set(eventId, { expires: Date.now() + CACHE_TTL_MS, events: out });
  return out.slice(0, limit);
}
