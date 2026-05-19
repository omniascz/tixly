/**
 * AI semantic search nad events.
 *
 * Production: OpenAI text-embedding-3-small + pgvector.
 * Demo (stub): query parsing s intent extraction (when, where, price, audience, vibe)
 * + structured filtering nad existing eventy. Pak content scoring.
 *
 * Pg_trgm: po migraci 270 fuzzy match přes trigram similarity nad
 *   catalog.events.title/description, catalog.venues.name/city,
 *   platform.promoters.name. Typo tolerance ~ 0.3 default threshold,
 *   ILIKE fallback zůstává.
 *
 * Pro plnou production: nastavit `pgvector` extension a embeddings cron.
 */

import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface SearchQuery {
  raw: string;
  locale?: string;
}

export interface ParsedIntent {
  audienceTag?: 'family' | 'adult' | 'student' | 'senior' | 'vip';
  vibeTag?: 'energetic' | 'intimate' | 'spectacular' | 'underground' | 'outdoor' | 'formal';
  genreTag?: string;
  city?: string;
  maxPriceMinor?: number;
  dateRange?: 'today' | 'tomorrow' | 'this_weekend' | 'this_week' | 'next_week' | 'this_month';
  category?: string;
  keywords: string[];
}

export interface SearchResult {
  eventId: string;
  title: string;
  date_start: string;
  venue_name: string | null;
  category: string;
  min_price: number | null;
  currency: string;
  matchScore: number;
  matchedReasons: string[];
}

const AUDIENCE_RX = {
  family: /\b(rodin|dět|kids|children|family)/i,
  adult: /\b(18\+|21\+|adult|erotic)/i,
  student: /\b(student|isic|mládež)/i,
  senior: /\b(senior)/i,
  vip: /\b(vip|premium|luxury)/i,
} as const;

const VIBE_RX = {
  energetic: /\b(energ|wild|banger|pump)/i,
  intimate: /\b(intimate|akustic|unplugged)/i,
  spectacular: /\b(lights|spektákl|visual)/i,
  underground: /\b(underground|klub)/i,
  outdoor: /\b(open[- ]?air|venku|outdoor)/i,
  formal: /\b(gala|ples|banquet)/i,
} as const;

const GENRE_RX = {
  rock: /\b(rock|metal|punk)/i,
  pop: /\bpop\b/i,
  electronic: /\b(edm|techno|house|electronic|dnb)/i,
  jazz: /\bjazz\b/i,
  classical: /\b(klasik|symfonický|filharmonie|opera)/i,
  hiphop: /\b(hip[- ]?hop|rap)/i,
};

const CATEGORY_RX = {
  concert: /\b(koncert|concert)/i,
  festival: /\b(festival)/i,
  theatre: /\b(divadl|theatre|theater)/i,
  club_party: /\b(klub|club|party|párty)/i,
  sports: /\b(zápas|match|sport)/i,
  conference: /\b(conference|konference)/i,
  workshop: /\b(workshop|kurz)/i,
  family: /\b(rodin)/i,
  comedy: /\b(comedy|komed|standup|stand[- ]?up)/i,
};

const DATE_RX: Record<string, RegExp> = {
  today: /\b(dnes|today)/i,
  tomorrow: /\b(zítra|tomorrow)/i,
  this_weekend: /\b(víkend|weekend)/i,
  this_week: /\b(tento týden|this week)/i,
  next_week: /\b(příští týden|next week)/i,
  this_month: /\b(tento měsíc|this month)/i,
};

const PRICE_RX = /\b(?:do|under|max(?:imálně)?)\s*(\d{2,5})\s*(?:Kč|czk|eur|€)?/i;

const CITIES: Record<string, RegExp> = {
  // Czech: Praha / Prahy / Prahu / Praho / Praze / Prahou
  Prague: /\b(prah[ayuo]|prahou|praze|prague)/i,
  // Brno / Brna / Brnu / Brně
  Brno: /\b(brn[aou]|brně)/i,
  // Ostrava / Ostravy / Ostravě / Ostravou
  Ostrava: /\b(ostrav[aey]|ostravě|ostravou)/i,
  // Plzeň / Plzně / Plzni
  Plzeň: /\b(plz[eě]ň|plzni|plzně)/i,
};

export function parseIntent(raw: string): ParsedIntent {
  const out: ParsedIntent = { keywords: [] };

  for (const [tag, rx] of Object.entries(AUDIENCE_RX)) {
    if (rx.test(raw)) {
      out.audienceTag = tag as ParsedIntent['audienceTag'];
      break;
    }
  }
  for (const [tag, rx] of Object.entries(VIBE_RX)) {
    if (rx.test(raw)) {
      out.vibeTag = tag as ParsedIntent['vibeTag'];
      break;
    }
  }
  for (const [tag, rx] of Object.entries(GENRE_RX)) {
    if (rx.test(raw)) {
      out.genreTag = tag;
      break;
    }
  }
  for (const [tag, rx] of Object.entries(CATEGORY_RX)) {
    if (rx.test(raw)) {
      out.category = tag;
      break;
    }
  }
  for (const [city, rx] of Object.entries(CITIES)) {
    if (rx.test(raw)) {
      out.city = city;
      break;
    }
  }
  for (const [d, rx] of Object.entries(DATE_RX)) {
    if (rx.test(raw)) {
      out.dateRange = d as ParsedIntent['dateRange'];
      break;
    }
  }
  const priceMatch = PRICE_RX.exec(raw);
  if (priceMatch) {
    out.maxPriceMinor = Number.parseInt(priceMatch[1], 10) * 100;
  }
  // Keywords: words 3+ chars, not stop words
  const STOPWORDS = new Set([
    'pro', 'jak', 'pak', 'tak', 'ale', 'pro', 'pod', 'nad', 'this', 'that', 'with',
    'for', 'and', 'the', 'akce', 'event', 'akci', 'akcí',
  ]);
  out.keywords = raw
    .toLowerCase()
    .split(/[^a-z0-9áéíóúčďěňřšťůýž]+/i)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .slice(0, 10);
  return out;
}

function dateRangeBounds(d: ParsedIntent['dateRange']): { from: Date; to: Date } | null {
  const now = new Date();
  switch (d) {
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { from: start, to: end };
    }
    case 'tomorrow': {
      const start = new Date(now);
      start.setDate(start.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { from: start, to: end };
    }
    case 'this_weekend': {
      const start = new Date(now);
      const day = start.getDay();
      const diffToFri = (5 - day + 7) % 7;
      start.setDate(start.getDate() + diffToFri);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 3);
      return { from: start, to: end };
    }
    case 'this_week': {
      const start = new Date(now);
      const end = new Date(now);
      end.setDate(end.getDate() + 7);
      return { from: start, to: end };
    }
    case 'next_week': {
      const start = new Date(now);
      start.setDate(start.getDate() + 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { from: start, to: end };
    }
    case 'this_month': {
      const start = new Date(now);
      const end = new Date(now);
      end.setMonth(end.getMonth() + 1);
      return { from: start, to: end };
    }
    default:
      return null;
  }
}

export async function semanticSearch(query: SearchQuery, limit = 20): Promise<{
  intent: ParsedIntent;
  results: SearchResult[];
}> {
  const intent = parseIntent(query.raw);

  const conditions: string[] = [`e.status = 'published'`, `e.date_start > NOW() - INTERVAL '1 day'`];
  const args: unknown[] = [];

  if (intent.category) {
    args.push(intent.category);
    conditions.push(`e.category = $${args.length}`);
  }
  const dateBounds = dateRangeBounds(intent.dateRange);
  if (dateBounds) {
    args.push(dateBounds.from.toISOString());
    conditions.push(`e.date_start >= $${args.length}`);
    args.push(dateBounds.to.toISOString());
    conditions.push(`e.date_start < $${args.length}`);
  }
  if (intent.city) {
    args.push(`%${intent.city}%`);
    conditions.push(`(v.address ILIKE $${args.length} OR v.name ILIKE $${args.length})`);
  }
  if (intent.audienceTag || intent.vibeTag || intent.genreTag) {
    const tags: string[] = [];
    if (intent.audienceTag) tags.push(intent.audienceTag);
    if (intent.vibeTag) tags.push(intent.vibeTag);
    if (intent.genreTag) tags.push(intent.genreTag);
    args.push(tags);
    conditions.push(`e.ai_tags && $${args.length}::text[]`);
  }

  // Trigram fuzzy match nad keywords — typo tolerance přes pg_trgm.
  // Když keywords[0..2] mají alespoň 3 znaky, vytvořit OR clauses,
  // které matchují jak exact substring (ILIKE) tak trigram similarity (%).
  // Když DB ještě nemá pg_trgm (migrace 270), padne na ILIKE only.
  let trgmKeyword: string | null = null;
  if (intent.keywords.length > 0) {
    trgmKeyword = intent.keywords.slice(0, 3).join(' ');
    args.push(trgmKeyword);
    const $idx = args.length;
    conditions.push(`(
      e.title ILIKE '%' || $${$idx} || '%'
      OR e.description ILIKE '%' || $${$idx} || '%'
      OR e.title % $${$idx}
      OR v.name % $${$idx}
      OR v.city % $${$idx}
    )`);
  }

  // Order: pokud máme keyword, řadit podle title similarity desc, jinak chronologicky
  const orderBy = trgmKeyword
    ? `GREATEST(similarity(e.title, $${args.length}), similarity(COALESCE(v.name, ''), $${args.length})) DESC,
       e.date_start ASC`
    : `e.date_start ASC`;

  let rows: Array<{
    id: string;
    title: string;
    description: string | null;
    date_start: string;
    category: string;
    venue_name: string | null;
    min_price: string | null;
    currency: string;
    ai_tags: string[];
  }>;
  try {
    const r = await db().query<{
      id: string;
      title: string;
      description: string | null;
      date_start: string;
      category: string;
      venue_name: string | null;
      min_price: string | null;
      currency: string;
      ai_tags: string[];
    }>(
      `SELECT e.id, e.title, e.description, e.date_start, e.category,
              v.name AS venue_name,
              (SELECT MIN(base_price)::text FROM catalog.ticket_types WHERE event_id = e.id) AS min_price,
              e.currency,
              COALESCE(e.ai_tags, '{}') AS ai_tags
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT 200`,
      args,
    );
    rows = r.rows;
  } catch (err) {
    // Pre-migrace 270 fallback — pg_trgm operátor `%` ještě neexistuje.
    // Re-run bez trigram conditions, jen ILIKE.
    if (
      err instanceof Error &&
      /operator does not exist.*% text/.test(err.message)
    ) {
      const fallbackConditions = conditions.filter(
        (c) => !c.includes('e.title %') && !c.includes('v.name %') && !c.includes('v.city %'),
      );
      const r2 = await db().query(
        `SELECT e.id, e.title, e.description, e.date_start, e.category,
                v.name AS venue_name,
                (SELECT MIN(base_price)::text FROM catalog.ticket_types WHERE event_id = e.id) AS min_price,
                e.currency,
                COALESCE(e.ai_tags, '{}') AS ai_tags
         FROM catalog.events e
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         WHERE ${fallbackConditions.join(' AND ')}
         ORDER BY e.date_start ASC
         LIMIT 200`,
        args,
      );
      rows = r2.rows as typeof rows;
    } else {
      throw err;
    }
  }
  const r = { rows };

  // Score each event vs query keywords + intent
  const results: SearchResult[] = [];
  for (const row of r.rows) {
    const corpus = `${row.title} ${row.description ?? ''} ${row.category} ${(row.ai_tags ?? []).join(' ')} ${row.venue_name ?? ''}`.toLowerCase();
    let score = 0.3; // baseline pass through filter
    const reasons: string[] = [];
    for (const kw of intent.keywords) {
      if (corpus.includes(kw)) {
        score += 0.1;
        reasons.push(`match:${kw}`);
      }
    }
    if (intent.maxPriceMinor !== undefined && row.min_price !== null) {
      if (Number(row.min_price) <= intent.maxPriceMinor) {
        score += 0.1;
        reasons.push('within_price');
      } else {
        // Price filter — exclude
        continue;
      }
    }
    if (intent.category && row.category === intent.category) {
      reasons.push(`category:${intent.category}`);
    }
    if (intent.audienceTag && (row.ai_tags ?? []).includes(intent.audienceTag)) {
      reasons.push(`audience:${intent.audienceTag}`);
    }
    if (intent.vibeTag && (row.ai_tags ?? []).includes(intent.vibeTag)) {
      reasons.push(`vibe:${intent.vibeTag}`);
    }
    if (intent.genreTag && (row.ai_tags ?? []).includes(intent.genreTag)) {
      score += 0.2;
      reasons.push(`genre:${intent.genreTag}`);
    }
    if (intent.city && (row.venue_name ?? '').toLowerCase().includes(intent.city.toLowerCase())) {
      score += 0.1;
      reasons.push(`city:${intent.city}`);
    }
    results.push({
      eventId: row.id,
      title: row.title,
      date_start: row.date_start,
      venue_name: row.venue_name,
      category: row.category,
      min_price: row.min_price !== null ? Number(row.min_price) : null,
      currency: row.currency,
      matchScore: Math.min(1, score),
      matchedReasons: reasons,
    });
  }

  results.sort((a, b) => b.matchScore - a.matchScore);
  return { intent, results: results.slice(0, limit) };
}
