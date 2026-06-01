/**
 * Marketplace Ads — slot auction.
 *
 * Pro daný slot najde nejlepší aktivní kampaně (highest CPC), respektuje
 * budget_remaining a status. Inkrementuje impressions counter.
 */
import { db } from "@/lib/db/rls-pool";



export type AdSlot = 'homepage_hero' | 'homepage_featured' | 'category_top' | 'search_top';

export interface AdPlacement {
  campaignId: string;
  eventId: string;
  eventTitle: string;
  eventImageUrl: string | null;
  promoterId: string;
  promoterName: string;
  cpcHalire: number;
}

/**
 * Najdi nejvyšší CPC kampaně pro slot. Optional category filter (pro category_top / search_top).
 * limit = max počet placements (typicky 1 pro hero, 4 pro featured).
 */
export async function findPlacementsForSlot(
  slot: AdSlot,
  options: { category?: string; limit?: number } = {},
): Promise<AdPlacement[]> {
  const limit = options.limit ?? 4;
  const args: unknown[] = [slot];
  let categoryClause = '';
  if (options.category) {
    args.push(options.category);
    categoryClause = ` AND (ac.category IS NULL OR ac.category = $${args.length})`;
  }
  args.push(limit);

  const r = await db().query<{
    id: string;
    event_id: string;
    event_title: string;
    event_image_url: string | null;
    promoter_id: string;
    promoter_name: string;
    cpc_halire: number;
  }>(
    `SELECT ac.id, ac.event_id, e.title AS event_title, e.cover_image_url AS cover_image AS event_image_url,
            ac.promoter_id, p.name AS promoter_name, ac.cpc_halire
     FROM marketing.ad_campaigns ac
     JOIN catalog.events e ON e.id = ac.event_id
     JOIN platform.promoters p ON p.id = ac.promoter_id
     WHERE ac.slot = $1
       AND ac.status = 'active'
       AND ac.budget_remaining >= ac.cpc_halire
       AND (ac.ends_at IS NULL OR ac.ends_at > NOW())
       AND ac.starts_at <= NOW()
       AND e.status = 'published'
       ${categoryClause}
     ORDER BY ac.cpc_halire DESC, RANDOM()
     LIMIT $${args.length}`,
    args,
  );

  if (r.rows.length > 0) {
    // Fire-and-forget impression counter
    const ids = r.rows.map((row) => row.id);
    void db().query(
      `UPDATE marketing.ad_campaigns SET impressions = impressions + 1, updated_at = NOW()
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );
  }

  return r.rows.map((row) => ({
    campaignId: row.id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    eventImageUrl: row.event_image_url,
    promoterId: row.promoter_id,
    promoterName: row.promoter_name,
    cpcHalire: row.cpc_halire,
  }));
}

/**
 * Track click → dekrement budget. Pokud po dekrementu nezbývá na další klik,
 * status = 'depleted'. Vrátí event_id pro redirect.
 */
export async function trackAdClick(input: {
  campaignId: string;
  ip: string | null;
  userAgent: string | null;
  userId: string | null;
}): Promise<{ eventId: string; eventSlug: string | null } | null> {
  // Click dedup: skip pokud stejné IP klikne 2× za 5 min na stejnou kampaň
  if (input.ip) {
    const recent = await db().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM marketing.ad_clicks
       WHERE campaign_id = $1 AND ip = $2 AND created_at > NOW() - INTERVAL '5 minutes'`,
      [input.campaignId, input.ip],
    );
    if (Number(recent.rows[0]?.count ?? 0) > 0) {
      // Dedup — neplatíme za duplicitní klik, ale ještě vrátíme target.
      const ev = await db().query<{ event_id: string; slug: string | null }>(
        `SELECT ac.event_id, e.slug
         FROM marketing.ad_campaigns ac
         JOIN catalog.events e ON e.id = ac.event_id
         WHERE ac.id = $1`,
        [input.campaignId],
      );
      if (ev.rows.length === 0) return null;
      return { eventId: ev.rows[0].event_id, eventSlug: ev.rows[0].slug };
    }
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const c = await client.query<{ event_id: string; cpc_halire: number; budget_remaining: number }>(
      `SELECT event_id, cpc_halire, budget_remaining
       FROM marketing.ad_campaigns
       WHERE id = $1 AND status = 'active'
       FOR UPDATE`,
      [input.campaignId],
    );
    if (c.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const camp = c.rows[0];
    if (camp.budget_remaining < camp.cpc_halire) {
      await client.query(
        `UPDATE marketing.ad_campaigns SET status = 'depleted', updated_at = NOW() WHERE id = $1`,
        [input.campaignId],
      );
      await client.query('COMMIT');
      return null;
    }

    await client.query(
      `UPDATE marketing.ad_campaigns
       SET budget_remaining = budget_remaining - cpc_halire,
           clicks = clicks + 1,
           status = CASE WHEN budget_remaining - cpc_halire < cpc_halire THEN 'depleted' ELSE 'active' END,
           updated_at = NOW()
       WHERE id = $1`,
      [input.campaignId],
    );
    await client.query(
      `INSERT INTO marketing.ad_clicks (campaign_id, ip, user_agent, user_id, charged_halire)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.campaignId, input.ip, input.userAgent, input.userId, camp.cpc_halire],
    );

    const ev = await client.query<{ slug: string | null }>(
      `SELECT slug FROM catalog.events WHERE id = $1`,
      [camp.event_id],
    );

    await client.query('COMMIT');
    return {
      eventId: camp.event_id,
      eventSlug: ev.rows[0]?.slug ?? null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Vickrey (TM-style) auction s quality score ────────────────────

export interface VickreyContext {
  slot: AdSlot;
  shownOnEventId?: string;
  shownOnPromoterId?: string;
  category?: string;
  sessionHash?: string;
}

export interface VickreyResult {
  winningCampaignId: string | null;
  winningEventId: string | null;
  chargedHalire: number;
  participantsCount: number;
  topScore: number;
}

/**
 * Second-price auction s CTR-based quality score. Score = bid × quality_factor,
 * vítěz platí (2nd_score / winner_quality) + 1 (cap na vlastní bid).
 * Solo bidder → platí 50 % bid (min 100 hal).
 */
export async function runVickreyAuction(ctx: VickreyContext): Promise<VickreyResult> {
  const conditions: string[] = [
    `ac.status = 'active'`,
    `ac.budget_remaining > 0`,
    `(ac.ends_at IS NULL OR ac.ends_at > now())`,
    `ac.starts_at <= now()`,
    `ac.slot = $1`,
  ];
  const args: unknown[] = [ctx.slot];

  if (ctx.category) {
    args.push(ctx.category);
    conditions.push(`(ac.category IS NULL OR ac.category = $${args.length})`);
  }
  if (ctx.shownOnPromoterId) {
    args.push(ctx.shownOnPromoterId);
    conditions.push(`(ac.promoter_id = $${args.length} OR ac.cross_promo_enabled = true)`);
  }

  const r = await db().query<{
    id: string; event_id: string; cpc_halire: number;
    impressions: number; clicks: number;
  }>(
    `SELECT ac.id, ac.event_id, ac.cpc_halire, ac.impressions, ac.clicks
       FROM marketing.ad_campaigns ac
      WHERE ${conditions.join(' AND ')}`,
    args,
  );

  function quality(impressions: number, clicks: number): number {
    if (impressions < 100) return 1.0;
    const ctr = clicks / impressions;
    return Math.max(0.3, Math.min(2.5, 1.0 + (ctr - 0.02) * 25));
  }

  if (r.rows.length === 0) {
    void logVickrey(ctx, [], null, 0, 0);
    return { winningCampaignId: null, winningEventId: null, chargedHalire: 0, participantsCount: 0, topScore: 0 };
  }

  const scored = r.rows.map((c) => {
    const q = quality(c.impressions, c.clicks);
    return { ...c, q, score: c.cpc_halire * q };
  });
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];

  let charged: number;
  if (scored.length > 1) {
    const second = scored[1].score;
    charged = Math.min(winner.cpc_halire, Math.ceil(second / Math.max(winner.q, 0.01)) + 1);
  } else {
    charged = Math.max(100, Math.round(winner.cpc_halire * 0.5));
  }

  void logVickrey(
    ctx,
    scored.map((s) => ({
      campaign_id: s.id, bid_halire: s.cpc_halire,
      ctr: s.clicks / Math.max(s.impressions, 1), score: s.score,
    })),
    winner.id, winner.score, charged,
  );

  return {
    winningCampaignId: winner.id,
    winningEventId: winner.event_id,
    chargedHalire: charged,
    participantsCount: scored.length,
    topScore: winner.score,
  };
}

async function logVickrey(
  ctx: VickreyContext,
  participants: { campaign_id: string; bid_halire: number; ctr: number; score: number }[],
  winnerId: string | null, topScore: number, charged: number,
): Promise<void> {
  await db().query(
    `INSERT INTO marketing.ad_auction_log
       (slot, shown_on_event_id, shown_on_promoter_id, participants,
        winning_campaign_id, winning_score, charged_halire, user_session_hash)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
    [
      ctx.slot, ctx.shownOnEventId ?? null, ctx.shownOnPromoterId ?? null,
      JSON.stringify(participants), winnerId, topScore, charged, ctx.sessionHash ?? null,
    ],
  ).catch((e) => console.error('[ad_auction_log]', e));
}
