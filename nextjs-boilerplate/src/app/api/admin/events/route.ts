/**
 * /api/admin/events
 * - GET: list akcí promotéra (pro dropdown / přehled)
 * - POST: vytvoření akce + ticket types (s keyword moderací)
 *
 * Auth: middleware ověří JWT a nastaví header x-user-id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';
import {
  runAiGate,
  TRUST_THRESHOLD_PUBLISHED_EVENTS,
} from '@/lib/moderation/ai-gate';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit/per-tenant';
import { copyLayoutToEventSeats } from '@/lib/seats/copy-layout-to-event-seats';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface EventRow {
  id: string;
  title: string;
  date_start: string;
  status: string;
  rejection_reason: string | null;
}

export async function GET(request: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(request);
  if (!promoter) {
    return NextResponse.json({ error: 'Not a promoter member' }, { status: 403 });
  }

  // Pro každou akci najdeme nejnovější moderation log entry s decision='rejected',
  // pokud je akce v stavu rejected — promotér potřebuje vědět DŮVOD.
  const query = `
    SELECT
      e.id, e.title, e.date_start, e.status,
      CASE WHEN e.status = 'rejected' THEN (
        SELECT log.reason
        FROM audit.event_moderation_log log
        WHERE log.event_id = e.id AND log.decision = 'rejected'
        ORDER BY log.created_at DESC
        LIMIT 1
      ) ELSE NULL END AS rejection_reason
    FROM catalog.events e
    WHERE e.promoter_id = $1
    ORDER BY e.date_start DESC
    LIMIT 100
  `;
  const result = await db().query<EventRow>(query, [promoter.promoterId]);

  return NextResponse.json(
    result.rows.map((row) => ({
      id: row.id,
      name: row.title,
      date: row.date_start,
      moderationStatus: row.status,
      rejectionReason: row.rejection_reason,
    })),
  );
}

// Access spec — který den (index) a která zóna (název) tato vstupenka pokrývá.
// dayIndex/zoneName může být 'all' pro wildcard.
const accessSpecSchema = z.object({
  dayIndex: z.union([z.number().int().min(0), z.literal('all')]),
  zoneName: z.union([z.string().min(1).max(100), z.literal('all')]),
  level: z
    .enum(['general', 'premium', 'vip', 'backstage', 'accessibility'])
    .default('general'),
});

const ticketTypeSchema = z.object({
  name: z.string().min(1).max(100),
  priceHalire: z.number().int().min(0),
  capacity: z.number().int().min(1).max(100000),
  maxPerUser: z.number().int().min(1).max(100).nullable().optional(),
  description: z.string().max(500).optional(),
  // Access manifest — pokud chybí, vstupenka je general/all/all (single event default).
  access: z.array(accessSpecSchema).optional(),
  // Seating mapping. `zone` matchuje sektor v venue_seating_charts.layout
  // (přesně nebo přes prefix). Pro standing eventy nech null.
  zone: z.string().min(1).max(100).nullable().optional(),
  isSeated: z.boolean().default(false),
});

const dayInputSchema = z.object({
  label: z.string().max(100).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  notes: z.string().max(500).optional(),
});

const zoneInputSchema = z.object({
  name: z.string().min(1).max(100),
  zoneType: z
    .enum([
      'general',
      'stage',
      'vip',
      'premium',
      'backstage',
      'camping',
      'parking',
      'accessibility',
      'other',
    ])
    .default('general'),
  capacity: z.number().int().min(1).max(500_000).nullable().optional(),
  description: z.string().max(500).optional(),
});

const TEMPLATE_IDS = [
  'single_event',
  'multi_day_festival',
  'sport_season',
  'theatre_subscription',
  'conference',
  'open_air',
  'workshop_series',
  'online_stream',
] as const;

const EVENT_CATEGORIES = [
  'concert',
  'festival',
  'theatre',
  'club_party',
  'sports',
  'conference',
  'workshop',
  'family',
  'comedy',
  'other',
] as const;

const EVENT_TYPES = [
  'concert',
  'theatre',
  'sport',
  'festival',
  'conference',
  'workshop',
  'club',
  'family',
  'online',
  'hybrid',
  'other',
] as const;

const createSchema = z.object({
  // Template
  template: z.enum(TEMPLATE_IDS).default('single_event'),

  // Krok 1: Základ
  title: z.string().min(2).max(200),
  description: z.string().max(5000).optional(),
  category: z.enum(EVENT_CATEGORIES).default('concert'),
  eventType: z.enum(EVENT_TYPES).default('concert'),

  // Krok 2: Datum & místo
  dateStart: z.string().datetime(),
  dateEnd: z.string().datetime().nullable().optional(),
  saleStartAt: z.string().datetime().nullable().optional(),
  saleEndAt: z.string().datetime().nullable().optional(),
  venueId: z.string().uuid().nullable().optional(),

  // Currency: ISO 4217 (CZK default; EUR/USD/GBP/PLN supported)
  currency: z.enum(['CZK', 'EUR', 'USD', 'GBP', 'PLN']).default('CZK'),

  // Festival multi-day struktura — explicitní dny + zóny
  // Pro single_event je to volitelné (server vygeneruje 1 day + 1 zone z dateStart/dateEnd).
  days: z.array(dayInputSchema).max(50).optional(),
  zones: z.array(zoneInputSchema).max(50).optional(),

  // Krok 3: Vstupenky (s access manifestem)
  ticketTypes: z.array(ticketTypeSchema).min(1).max(50),
  maxTicketsPerOrder: z.number().int().min(1).max(100).nullable().optional(),

  // Krok 4: Marketing
  coverImageUrl: z.string().url().max(500).nullable().optional(),

  // Krok 5: Pravidla
  minAge: z.number().int().min(0).max(99).nullable().optional(),
  resaleAllowed: z.boolean().default(true),

  // CZ/SK launch — volitelné per-event overrides (jinak default z promotér country)
  refundDeadlineDays: z.number().int().min(0).max(90).nullable().optional(),
  refundFeePct: z.number().int().min(0).max(10000).nullable().optional(),
  qrPolicy: z
    .enum(['static_allowed', 'rotating_24h', 'rotating_only', 'photo_required'])
    .optional(),
  vatCategory: z
    .enum(['standard', 'cultural', 'food_beverage', 'merchandise', 'reduced'])
    .optional(),

  // Krok 6: Publikace (volitelné — promotér může uložit jako draft)
  publishImmediately: z.boolean().default(false),
});

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (promoter.status !== 'active') {
    return NextResponse.json(
      {
        error: `Tvůj promotér účet má status "${promoter.status}". Akci může vytvořit jen schválený promotér.`,
      },
      { status: 403 },
    );
  }

  // Rate limit: max 20 events/min per tenant. Brání spam-blokům přes scammer
  // accounty, ale pohodlně umožňuje legit hromadné importy z UI nebo API.
  const rl = checkRateLimit(`${promoter.promoterId}:event-create`, {
    limit: 20,
    windowMs: 60_000,
  });
  const rlResp = rateLimitResponse(rl, 'event-create');
  if (rlResp) return rlResp;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;
  const client = await db().connect();

  // CZ/SK launch — fetch promoter country/currency pro default fields
  const promoterDefaults = await db().query<{
    country: string;
    primary_currency: string;
    tier: number;
  }>(
    `SELECT country, primary_currency, tier
       FROM platform.promoters WHERE id = $1`,
    [promoter.promoterId],
  );
  const pd = promoterDefaults.rows[0];
  const promoterCountry = pd?.country ?? 'CZ';
  const promoterTier = pd?.tier ?? 1;

  // Resolve event-level defaults (per-event override > promoter country default)
  const effectiveCurrency =
    input.currency === 'CZK' && promoterCountry === 'SR' && pd?.primary_currency === 'EUR'
      ? 'EUR'
      : input.currency;
  const effectiveQrPolicy = input.qrPolicy ?? 'static_allowed';
  const effectiveVatCategory = input.vatCategory ?? 'cultural';
  // Refund deadline: tier 1 promotéři dostávají kratší default (7 dní), tier 2+ standardní
  const defaultRefundDeadline = promoterTier >= 2 ? 7 : 7;
  const effectiveRefundDeadline = input.refundDeadlineDays ?? defaultRefundDeadline;
  const effectiveRefundFeePct = input.refundFeePct ?? 500; // 5 %

  try {
    await client.query('BEGIN');

    // Vrstva 1: keyword blocklist scan
    const haystack = [
      input.title,
      input.description ?? '',
      ...input.ticketTypes.map((t) => t.name),
    ]
      .join(' ')
      .toLowerCase();

    const blocklistRes = await client.query<{
      keyword: string;
      category: string;
      severity: string;
    }>(`SELECT keyword, category, severity FROM catalog.moderation_blocklist`);
    const matched = blocklistRes.rows.filter((row) =>
      haystack.includes(row.keyword.toLowerCase()),
    );
    const autoReject = matched.some((m) => m.severity === 'auto_reject');
    const flagForReview = matched.some((m) => m.severity === 'flag_for_review');

    // Vrstva 2: AI moderation gate (skip pokud už keyword auto-rejected)
    let initialStatus: 'rejected' | 'pending_review' | 'published' = autoReject
      ? 'rejected'
      : 'pending_review';
    let aiReasoning: string | null = null;

    if (!autoReject) {
      // Trust signal: kolik publikovaných akcí má promotér v posledních 90 dnech
      const trustRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM catalog.events
         WHERE promoter_id = $1
           AND status = 'published'
           AND created_at > NOW() - INTERVAL '90 days'`,
        [promoter.promoterId],
      );
      const publishedCount = Number(trustRes.rows[0]?.count ?? 0);
      const trusted = publishedCount >= TRUST_THRESHOLD_PUBLISHED_EVENTS;

      const gate = await runAiGate(
        {
          title: input.title,
          description: input.description,
          ticketTypeNames: input.ticketTypes.map((t) => t.name),
        },
        trusted,
      );
      initialStatus = gate.status;
      aiReasoning = gate.ai.reasoning;
    }

    // Pokud nebylo zvoleno místo, vytvoříme placeholder venue (events.venue_id je NOT NULL)
    let venueId = input.venueId ?? null;
    if (!venueId) {
      const totalCapacity = input.ticketTypes.reduce((s, t) => s + t.capacity, 0);
      const venueRes = await client.query<{ id: string }>(
        `INSERT INTO catalog.venues
           (name, address, city, country, capacity, venue_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING id`,
        ['Online / TBD', '—', '—', 'CZ', Math.max(totalCapacity, 1), 'online'],
      );
      venueId = venueRes.rows[0].id;
    }

    // Pokud promotér ve formuláři chce „save as draft", obejdeme moderaci
    // (akce nepůjde do prodeje, dokud sám neklikne Publish).
    if (!input.publishImmediately && !autoReject) {
      initialStatus = 'pending_review'; // bude se moderovat při pozdějším publish kliknutí
    }

    const eventRes = await client.query<{ id: string }>(
      `INSERT INTO catalog.events (
         organizer_id, promoter_id, venue_id, title, description,
         category, event_type, template,
         date_start, date_end, sale_start_at, sale_end_at,
         status, min_age, max_tickets_per_order,
         resale_allowed, cover_image_url,
         currency, timezone,
         refund_deadline_days, refund_fee_pct, qr_policy, vat_category,
         created_at, updated_at
       ) VALUES (
         $1, $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11,
         $12, $13, $14, $15, $16,
         $17, 'Europe/Prague',
         $18, $19, $20, $21,
         NOW(), NOW()
       )
       RETURNING id`,
      [
        promoter.promoterId,
        venueId,
        input.title,
        input.description ?? null,
        input.category,
        input.eventType,
        input.template,
        input.dateStart,
        input.dateEnd ?? null,
        input.saleStartAt ?? null,
        input.saleEndAt ?? null,
        initialStatus,
        input.minAge && input.minAge > 0 ? input.minAge : null,
        input.maxTicketsPerOrder ?? null,
        input.resaleAllowed,
        input.coverImageUrl ?? null,
        effectiveCurrency,
        effectiveRefundDeadline,
        effectiveRefundFeePct,
        effectiveQrPolicy,
        effectiveVatCategory,
      ],
    );
    const eventId = eventRes.rows[0].id;

    // Days — pokud promotér nezadal, vygenerujeme 1 default den z dateStart/dateEnd
    const daysInput = input.days && input.days.length > 0
      ? input.days
      : [
          {
            label: 'Hlavní termín',
            startsAt: input.dateStart,
            endsAt: input.dateEnd ?? input.dateStart,
            notes: undefined,
          },
        ];
    const dayIds: string[] = [];
    for (let i = 0; i < daysInput.length; i++) {
      const d = daysInput[i];
      const dr = await client.query<{ id: string }>(
        `INSERT INTO catalog.event_days
           (event_id, day_index, starts_at, ends_at, label, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [eventId, i, d.startsAt, d.endsAt, d.label ?? null, d.notes ?? null],
      );
      dayIds.push(dr.rows[0].id);
    }

    // Zones — pokud nejsou, jeden default 'general' zone
    const zonesInput =
      input.zones && input.zones.length > 0
        ? input.zones
        : [{ name: 'Hlavní', zoneType: 'general' as const }];
    const zoneIdsByName = new Map<string, string>();
    for (let i = 0; i < zonesInput.length; i++) {
      const z = zonesInput[i];
      const zr = await client.query<{ id: string }>(
        `INSERT INTO catalog.event_zones
           (event_id, name, zone_type, capacity, display_order, description)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [eventId, z.name, z.zoneType, z.capacity ?? null, i, z.description ?? null],
      );
      zoneIdsByName.set(z.name, zr.rows[0].id);
    }

    // Ticket types + access manifest
    for (const tt of input.ticketTypes) {
      const ttr = await client.query<{ id: string }>(
        `INSERT INTO catalog.ticket_types
           (event_id, name, kind, base_price, total_qty, remaining_qty,
            max_per_user, zone, is_seated, created_at)
         VALUES ($1, $2, 'standing', $3, $4, $4, $5, $6, $7, NOW())
         RETURNING id`,
        [
          eventId,
          tt.name,
          tt.priceHalire,
          tt.capacity,
          tt.maxPerUser ?? null,
          tt.zone ?? null,
          tt.isSeated ?? false,
        ],
      );
      const ticketTypeId = ttr.rows[0].id;

      // Default access spec (žádný = wildcard all/all/general)
      const accessSpecs = tt.access && tt.access.length > 0
        ? tt.access
        : [{ dayIndex: 'all' as const, zoneName: 'all' as const, level: 'general' as const }];

      for (const spec of accessSpecs) {
        const dayId =
          spec.dayIndex === 'all'
            ? null
            : (dayIds[spec.dayIndex] ?? null);
        const zoneId =
          spec.zoneName === 'all'
            ? null
            : (zoneIdsByName.get(spec.zoneName) ?? null);
        await client.query(
          `INSERT INTO catalog.ticket_type_access
             (ticket_type_id, event_day_id, zone_id, access_level)
           VALUES ($1, $2, $3, $4)`,
          [ticketTypeId, dayId, zoneId, spec.level],
        );
      }
    }

    // Most chart → event_seats. Pokud má sál active seating chart a aspoň
    // jeden ticket_type má `zone`, naplníme `event_seats` pro buyer SeatPicker.
    // Bez tohohle volání by buyer viděl prázdnou mapu (P0 bug session 13).
    const seatCopy = await copyLayoutToEventSeats(client, eventId);

    // Audit log (DSA legal trail)
    const decision = autoReject
      ? 'rejected'
      : initialStatus === 'rejected'
        ? 'rejected'
        : initialStatus === 'published'
          ? 'approved'
          : 'submitted';
    const actorType = autoReject ? 'auto_keyword' : 'auto_ai';
    const reasonParts: string[] = [];
    if (autoReject) {
      reasonParts.push(
        `Auto-reject: keyword(s) ${matched
          .filter((m) => m.severity === 'auto_reject')
          .map((m) => m.keyword)
          .join(', ')}`,
      );
    } else {
      if (flagForReview) {
        reasonParts.push(
          `Flagged keywords: ${matched.map((m) => m.keyword).join(', ')}`,
        );
      }
      if (aiReasoning) reasonParts.push(`AI gate: ${aiReasoning}`);
      if (reasonParts.length === 0) reasonParts.push('Submitted (default policy)');
    }
    await client.query(
      `INSERT INTO audit.event_moderation_log
         (event_id, actor_user_id, actor_type, decision, reason, matched_keywords)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        eventId,
        promoter.userId,
        actorType,
        decision,
        reasonParts.join(' | '),
        matched.map((m) => m.keyword),
      ],
    );

    await client.query('COMMIT');
    const message =
      initialStatus === 'rejected'
        ? 'Akce byla automaticky zamítnuta kvůli zakázanému obsahu. Pro vysvětlení kontaktuj support.'
        : initialStatus === 'published'
          ? 'Akce byla auto-publikována (AI gate + ověřený promotér).'
          : 'Akce čeká na schválení master adminem. Po schválení půjde do prodeje.';
    return NextResponse.json(
      {
        eventId,
        status: initialStatus,
        message,
        seatsCreated: seatCopy.insertedSeats,
        sectorsMapped: seatCopy.matchedSectors,
        sectorsSkipped: seatCopy.skippedSectors,
      },
      { status: 201 },
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/admin/events]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
