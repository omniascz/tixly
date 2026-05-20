/**
 * GraphQL resolvers — query implementations s DataLoader-like batching.
 *
 * Klíčové: každá query je single SQL where possible (žádný N+1).
 * Pro related fields (event.ticketTypes, promoter.upcomingEvents) lazy fetch.
 *
 * eslint-disable @typescript-eslint/explicit-module-boundary-types
 * Schéma je externí kontrakt (schema.graphql) — explicit return types
 * by jen duplikovaly to, co schema definuje.
 */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface EventRow {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  cover_image: string | null;
  event_type: string | null;
  status: string;
  date_start: string;
  date_end: string | null;
  min_age: number | null;
  currency: string;
  venue_id: string | null;
  promoter_id: string;
}

function mapEvent(row: EventRow & { cheapest_price?: string | null; sold_out?: boolean }): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    coverImage: row.cover_image,
    eventType: row.event_type,
    status: row.status,
    dateStart: row.date_start,
    dateEnd: row.date_end,
    minAge: row.min_age,
    currency: row.currency,
    cheapestPriceHalire: row.cheapest_price ? Number(row.cheapest_price) : null,
    soldOut: Boolean(row.sold_out),
    __venue_id: row.venue_id,
    __promoter_id: row.promoter_id,
  };
}

export const resolvers = {
  Query: {
    async event(_: unknown, args: { id?: string; slug?: string }) {
      let q = '';
      let arg: string;
      if (args.id) {
        q = `WHERE e.id = $1`;
        arg = args.id;
      } else if (args.slug) {
        q = `WHERE e.slug = $1`;
        arg = args.slug;
      } else {
        return null;
      }
      const r = await db().query<EventRow & { cheapest_price: string | null; sold_out: boolean }>(
        `SELECT e.id, e.slug, e.title, e.description, e.cover_image_url AS cover_image, e.event_type,
                e.status, e.date_start::text, e.date_end::text, e.min_age, e.currency,
                e.venue_id, e.promoter_id,
                (SELECT MIN(tt.base_price)::text FROM catalog.ticket_types tt
                 WHERE tt.event_id = e.id AND tt.remaining_qty > 0) AS cheapest_price,
                (SELECT BOOL_AND(remaining_qty = 0) FROM catalog.ticket_types
                 WHERE event_id = e.id) AS sold_out
         FROM catalog.events e
         ${q} AND e.status = 'published'
         LIMIT 1`,
        [arg],
      );
      return r.rows[0] ? mapEvent(r.rows[0]) : null;
    },

    async events(_: unknown, args: {
      limit?: number; offset?: number;
      city?: string; eventType?: string;
      promoterId?: string; promoterSlug?: string;
      dateFrom?: string; dateTo?: string;
    }) {
      const limit = Math.min(100, Math.max(1, args.limit ?? 20));
      const offset = Math.max(0, args.offset ?? 0);
      const filters: string[] = [`e.status = 'published'`];
      const params: unknown[] = [];

      if (args.city) {
        params.push(args.city);
        filters.push(`LOWER(v.city) = LOWER($${params.length})`);
      }
      if (args.eventType) {
        params.push(args.eventType);
        filters.push(`e.event_type = $${params.length}`);
      }
      if (args.promoterId) {
        params.push(args.promoterId);
        filters.push(`e.promoter_id = $${params.length}`);
      }
      if (args.promoterSlug) {
        params.push(args.promoterSlug);
        filters.push(`p.slug = $${params.length}`);
      }
      if (args.dateFrom) {
        params.push(args.dateFrom);
        filters.push(`e.date_start >= $${params.length}::timestamptz`);
      }
      if (args.dateTo) {
        params.push(args.dateTo);
        filters.push(`e.date_start <= $${params.length}::timestamptz`);
      }

      params.push(limit, offset);
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;

      const r = await db().query<EventRow & { cheapest_price: string | null; sold_out: boolean; total: string }>(
        `SELECT e.id, e.slug, e.title, e.description, e.cover_image_url AS cover_image, e.event_type,
                e.status, e.date_start::text, e.date_end::text, e.min_age, e.currency,
                e.venue_id, e.promoter_id,
                (SELECT MIN(tt.base_price)::text FROM catalog.ticket_types tt
                 WHERE tt.event_id = e.id AND tt.remaining_qty > 0) AS cheapest_price,
                (SELECT BOOL_AND(remaining_qty = 0) FROM catalog.ticket_types
                 WHERE event_id = e.id) AS sold_out,
                COUNT(*) OVER()::text AS total
         FROM catalog.events e
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         LEFT JOIN platform.promoters p ON p.id = e.promoter_id
         WHERE ${filters.join(' AND ')}
         ORDER BY e.date_start ASC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      );

      const total = r.rows.length > 0 ? Number(r.rows[0].total) : 0;
      return {
        nodes: r.rows.map((row) => mapEvent(row)),
        total,
        hasMore: offset + r.rows.length < total,
      };
    },

    async promoter(_: unknown, args: { slug: string }) {
      const r = await db().query<{
        id: string;
        slug: string;
        name: string;
        brand_color_hex: string | null;
        brand_logo_url: string | null;
      }>(
        `SELECT id, slug, name, brand_color_hex, brand_logo_url
         FROM platform.promoters
         WHERE slug = $1 AND status = 'active'`,
        [args.slug],
      );
      if (r.rows.length === 0) return null;
      return {
        id: r.rows[0].id,
        slug: r.rows[0].slug,
        name: r.rows[0].name,
        brandColorHex: r.rows[0].brand_color_hex,
        brandLogoUrl: r.rows[0].brand_logo_url,
      };
    },

    async searchEvents(_: unknown, args: { query: string; limit?: number }) {
      const limit = Math.min(50, args.limit ?? 20);
      const q = `%${args.query.trim()}%`;
      const r = await db().query<EventRow & { cheapest_price: string | null; sold_out: boolean }>(
        `SELECT e.id, e.slug, e.title, e.description, e.cover_image_url AS cover_image, e.event_type,
                e.status, e.date_start::text, e.date_end::text, e.min_age, e.currency,
                e.venue_id, e.promoter_id,
                (SELECT MIN(tt.base_price)::text FROM catalog.ticket_types tt
                 WHERE tt.event_id = e.id AND tt.remaining_qty > 0) AS cheapest_price,
                FALSE AS sold_out
         FROM catalog.events e
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         WHERE e.status = 'published' AND e.date_start > NOW()
           AND (e.title ILIKE $1 OR e.description ILIKE $1 OR v.name ILIKE $1 OR v.city ILIKE $1)
         ORDER BY e.date_start ASC
         LIMIT $2`,
        [q, limit],
      );
      return r.rows.map((row) => mapEvent(row));
    },

    async trending(_: unknown, args: { limit?: number }) {
      const limit = Math.min(50, args.limit ?? 10);
      const r = await db().query<EventRow & { cheapest_price: string | null; sold_out: boolean }>(
        `WITH velocity AS (
           SELECT e.id, COUNT(o.id) AS sales
           FROM catalog.events e
           LEFT JOIN orders.orders o ON o.event_id = e.id
             AND o.status = 'paid' AND o.paid_at > NOW() - INTERVAL '7 days'
           WHERE e.status = 'published' AND e.date_start > NOW()
           GROUP BY e.id
         )
         SELECT e.id, e.slug, e.title, e.description, e.cover_image_url AS cover_image, e.event_type,
                e.status, e.date_start::text, e.date_end::text, e.min_age, e.currency,
                e.venue_id, e.promoter_id,
                (SELECT MIN(tt.base_price)::text FROM catalog.ticket_types tt
                 WHERE tt.event_id = e.id AND tt.remaining_qty > 0) AS cheapest_price,
                FALSE AS sold_out
         FROM catalog.events e
         LEFT JOIN velocity vel ON vel.id = e.id
         WHERE e.status = 'published' AND e.date_start > NOW()
         ORDER BY vel.sales DESC NULLS LAST, e.date_start ASC
         LIMIT $1`,
        [limit],
      );
      return r.rows.map((row) => mapEvent(row));
    },
  },

  Event: {
    async venue(parent: { __venue_id: string | null }) {
      if (!parent.__venue_id) return null;
      const r = await db().query<{
        id: string;
        name: string;
        city: string | null;
        address: string | null;
        capacity: number | null;
        latitude: number | null;
        longitude: number | null;
      }>(
        `SELECT id, name, city, address, capacity, latitude, longitude
         FROM catalog.venues WHERE id = $1`,
        [parent.__venue_id],
      );
      return r.rows[0] ?? null;
    },
    async promoter(parent: { __promoter_id: string }) {
      const r = await db().query<{
        id: string;
        slug: string;
        name: string;
        brand_color_hex: string | null;
        brand_logo_url: string | null;
      }>(
        `SELECT id, slug, name, brand_color_hex, brand_logo_url
         FROM platform.promoters WHERE id = $1`,
        [parent.__promoter_id],
      );
      if (r.rows.length === 0) return null;
      return {
        id: r.rows[0].id,
        slug: r.rows[0].slug,
        name: r.rows[0].name,
        brandColorHex: r.rows[0].brand_color_hex,
        brandLogoUrl: r.rows[0].brand_logo_url,
      };
    },
    async ticketTypes(parent: { id: string }): Promise<unknown[]> {
      const r = await db().query<Record<string, unknown>>(
        `SELECT id, name, kind, base_price AS "basePrice",
                remaining_qty AS "remainingQty", total_qty AS "totalQty",
                zone, COALESCE(is_seated, FALSE) AS "isSeated",
                COALESCE(requires_personalization, FALSE) AS "requiresPersonalization",
                discount_kind AS "discountKind",
                verification_hint AS "verificationHint"
         FROM catalog.ticket_types
         WHERE event_id = $1
         ORDER BY base_price ASC`,
        [parent.id],
      );
      return r.rows;
    },
  },

  Promoter: {
    async upcomingEvents(parent: { id: string }, args: { limit?: number }) {
      const limit = Math.min(50, args.limit ?? 20);
      const r = await db().query<EventRow & { cheapest_price: string | null; sold_out: boolean }>(
        `SELECT id, slug, title, description, cover_image, event_type, status,
                date_start::text, date_end::text, min_age, currency,
                venue_id, promoter_id,
                (SELECT MIN(tt.base_price)::text FROM catalog.ticket_types tt
                 WHERE tt.event_id = catalog.events.id AND tt.remaining_qty > 0) AS cheapest_price,
                FALSE AS sold_out
         FROM catalog.events
         WHERE promoter_id = $1 AND status = 'published' AND date_start > NOW()
         ORDER BY date_start ASC
         LIMIT $2`,
        [parent.id, limit],
      );
      return r.rows.map((row) => mapEvent(row));
    },
  },
};
