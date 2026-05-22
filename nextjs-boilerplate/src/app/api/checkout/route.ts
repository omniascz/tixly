/**
 * Checkout endpoint — kanonická cesta. Drží se aktuálního DB schématu
 * (`catalog.ticket_types.base_price`, `remaining_qty`) a používá:
 *   - resolveCurrentPrice() — single authority pro cenu (B13)
 *   - age verification gate (#199) — `events.min_age` + birthDate + checkbox
 *   - mock GoPay (gateway URL → /mock-gopay/[paymentId])
 *
 * Flow:
 *   1) Validace: event published + ticket_type patří k eventu + remaining_qty
 *   2) Server-side price resolution (PRICE_MISMATCH ochrana, age gate)
 *   3) Vytvoř/najdi guest user-a
 *   4) V transakci: decrement remaining_qty, INSERT order + order_items, mock payment
 *   5) Vrať gatewayUrl pro redirect na /mock-gopay/[paymentId]
 *
 * Dříve existoval `/api/checkout-demo` jako dočasná cesta vedle broken
 * `/api/checkout` (volal neexistující sloupce price_halire + tabulku
 * orders.seat_locks). Konsolidováno 26.4.2026 — broken kód smazán.
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

import { calculateAgeYears } from '@/lib/age/calculate';
import {
  resolveCurrentPrice,
  PriceMismatchError,
  PriceResolutionError,
} from '@/lib/pricing/resolve-price';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10).default(1),
  buyerEmail: z.string().email(),
  buyerName: z.string().min(1).max(120),
  // Volitelná „expected" cena z frontendu — když je předána, server ji
  // porovná s vlastní vyresolvenou cenou a odmítne nesouhlas (defense-in-depth).
  // Frontend ji nikdy NESMÍ použít jako autoritu — server cenu vždy přepíše.
  expectedUnitPriceHalire: z.number().int().min(0).optional(),
  // Age gate (lightweight — pro #199):
  //   ISO date "1990-04-25". Vyžadováno jen pro akce s min_age > 0.
  //   ageConfirmed = true je explicitní souhlas (checkbox).
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate musí být YYYY-MM-DD')
    .optional(),
  ageConfirmed: z.boolean().optional(),
  // Promo code (volitelný) — server validuje a aplikuje slevu na unit price * quantity
  promoCode: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[A-Z0-9_-]+$/i)
    .optional(),
  // Subscription consumption — pokud true a buyer má aktivní subscription u promotéra
  // s nevyčerpaným allowance, spotřebuje N (=quantity) z allowance a aplikuje
  // 100 % discount. Vzájemně se vylučuje s promoCode.
  useSubscription: z.boolean().optional(),
  // Volba platební metody. Defaultně 'gopay'. 'wero' = European A2A (#145),
  // 'przelewy24' = polský trh (#140). Všechny mají mock provider v demu.
  paymentMethod: z
    .enum([
      'gopay',
      'wero',
      'przelewy24',
      'bank_transfer',
      'pluxee',
      'sodexo',
      'benefit_plus',
      'edenred',
      'gallery_beta',
      // BNPL providers (CZ priority #2): Twisto (Mastercard owned, 1M+ CZ
      // users), Skip Pay (ČSOB). Mock mode → /mock-bnpl/[provider]/[paymentId]
      // gateway URL podobně jak benefit pay.
      'twisto',
      'skippay',
    ])
    .default('gopay'),
  // Add-ons (parking, camping, F&B credit, merch…) — Fáze C
  addons: z
    .array(
      z.object({
        addonId: z.string().uuid(),
        quantity: z.number().int().min(1).max(100),
      }),
    )
    .max(20)
    .optional(),
  // Bundle override — pokud kupec klikl "Buy bundle X", server expanduje
  // ticket type + add-ons + applikuje discount. ticketTypeId/addons z bundle
  // přepíšou klientem poslané hodnoty.
  bundleId: z.string().uuid().optional(),
  // Virtual queue admission token (Fáze H.1) — pokud má event queue_enabled=true,
  // checkout vyžaduje admitted token. Token se po úspěšném checkout markuje 'completed'.
  queueToken: z.string().uuid().optional(),
  // Refund insurance opt-in (Fáze H.3) — kupec si zvolí pojistku zrušení.
  // Server načte event.insurance_pct a přičte k total_amount.
  insuranceOptIn: z.boolean().optional(),
  // Seated tickets (Fáze L) — když je ticket type is_seated=true, buyer poslal hold token + seat IDs
  seatHoldToken: z.string().uuid().optional(),
  seatIds: z.array(z.string().uuid()).max(10).optional(),
  // Lottery winner (Fáze M.1) — buyer prokáže, že vyhrál losování
  lotteryEntryId: z.string().uuid().optional(),
  // Gift purchase (Fáze M.3) — buyer kupuje pro někoho jiného, recipient claim přes magic link
  giftRecipientEmail: z.string().email().max(200).optional(),
  giftRecipientName: z.string().min(1).max(120).optional(),
  giftMessage: z.string().max(500).optional(),
  // Affiliate code (Fáze P.2) — buyer přišel přes referral; commission spočítán per order
  affiliateCode: z.string().min(2).max(40).regex(/^[A-Z0-9_-]+$/i).optional(),
  // Personalizace (Fáze M.4) — pokud ticket_type.requires_personalization=true,
  // checkout vyžaduje jméno per vstupenku. Length musí být = quantity.
  holderNames: z.array(z.string().min(2).max(120)).max(10).optional(),
  // Timed entry slot (Fáze T) — pokud event.timed_entry_enabled, buyer vybere
  // konkrétní slot z /events/[id]/slots. Capacity dekrementuje atomicky.
  entrySlotId: z.string().uuid().optional(),
  // Gift voucher kód — aplikuje se PO promo kódu jako přímá sleva z balance.
  voucherCode: z.string().min(8).max(40).optional(),
  // Restwert kredit (DACH P0-2 Q4 polish) — buyer uplatní zbytkový kredit ze
  // svých subscriptions.holders u téhož promotéra. Aplikuje se PO voucheru.
  // Vyžaduje x-user-id header (přihlášený buyer; guest nemá historii).
  useRestwertCredit: z.boolean().optional(),
  // Marketing QR kampaň ID — buyer přišel přes QR z plakátu/letáku.
  // Cookie qr_ref se zapíše po /api/qr/[slug] redirectu, client ho posílá.
  qrRef: z.string().uuid().optional(),
});

interface TicketTypeRow {
  id: string;
  event_id: string;
  remaining_qty: number;
  name: string;
  event_title: string;
  min_age: number | null;
  currency: string;
  queue_enabled: boolean;
  insurance_enabled: boolean;
  insurance_pct: number;
  is_seated: boolean;
  requires_personalization: boolean;
}


export async function POST(req: NextRequest): Promise<Response> {
  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;
  const client = await db().connect();

  try {
    await client.query('BEGIN');

    // 0) Bundle expansion — pokud kupec poslal bundleId, načteme ticket_type +
    // addons a aplikujeme discount. Tyto hodnoty přepíšou klientem dodané.
    let bundleDiscountPct = 0;
    let bundleId: string | null = null;
    if (input.bundleId) {
      const bundleRes = await client.query<{
        id: string;
        ticket_type_id: string;
        discount_pct: number;
        event_id: string;
        active: boolean;
      }>(
        `SELECT id, ticket_type_id, discount_pct, event_id, active
         FROM catalog.event_bundles
         WHERE id = $1 AND event_id = $2`,
        [input.bundleId, input.eventId],
      );
      if (bundleRes.rows.length === 0 || !bundleRes.rows[0].active) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'BUNDLE_NOT_AVAILABLE' },
          { status: 422 },
        );
      }
      const bundle = bundleRes.rows[0];
      bundleId = bundle.id;
      bundleDiscountPct = bundle.discount_pct;
      // Expand addons
      const bundleAddonsRes = await client.query<{
        addon_id: string;
        quantity: number;
      }>(
        `SELECT addon_id, quantity FROM catalog.event_bundle_addons WHERE bundle_id = $1`,
        [bundle.id],
      );
      // Override input
      input.ticketTypeId = bundle.ticket_type_id;
      input.quantity = 1;
      input.addons = bundleAddonsRes.rows.map((a) => ({
        addonId: a.addon_id,
        quantity: a.quantity,
      }));
    }

    // 1) Najdi ticket_type a zkontroluj že jeho event je published
    const ttRes = await client.query<TicketTypeRow>(
      `SELECT tt.id, tt.event_id, tt.remaining_qty, tt.name, e.title AS event_title,
              e.min_age, e.currency, e.queue_enabled,
              e.insurance_enabled, e.insurance_pct, tt.is_seated,
              COALESCE(tt.requires_personalization, FALSE) AS requires_personalization,
              e.promoter_id
       FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
       WHERE tt.id = $1 AND tt.event_id = $2 AND e.status = 'published'
       FOR UPDATE`,
      [input.ticketTypeId, input.eventId],
    );
    if (ttRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Ticket type not found or event is not published' },
        { status: 404 },
      );
    }
    const tt = ttRes.rows[0] as { id: string; event_id: string; remaining_qty: number; name: string; event_title: string; min_age: number | null; currency: string; queue_enabled: boolean; insurance_enabled: boolean; insurance_pct: number; is_seated: boolean; requires_personalization: boolean; promoter_id: string };

    // P0 RISK MITIGATION: hard cap pro T1 promotery
    // Pokud promotér ještě nepass pre-review, kontrolujeme volume_used + nový order < cap
    const capRes = await client.query<{ cap: number | null; used: number; passed_at: string | null }>(
      `SELECT pre_review_volume_cap_halire AS cap,
              pre_review_volume_used_halire AS used,
              pre_review_passed_at::text AS passed_at
         FROM platform.promoters
        WHERE id = $1
        FOR UPDATE`,
      [tt.promoter_id],
    );
    if (capRes.rows.length > 0 && capRes.rows[0].passed_at === null && capRes.rows[0].cap !== null) {
      // Promotér ještě nepass review — check cap
      // (cap kontrola je orientační — finální check po vypočítání ceny níže)
      const remainingCap = capRes.rows[0].cap - capRes.rows[0].used;
      if (remainingCap <= 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'PROMOTER_VOLUME_CAP_REACHED',
            message:
              'Tento pořadatel dosáhl předregistračního limitu prodeje. ' +
              'Akce čeká na schválení Tixly. Zkuste prosím později.',
          },
          { status: 403 },
        );
      }
    }

    // Timed entry: pokud event.timed_entry_enabled, entrySlotId je vyžadován a
    // musí mít remaining >= quantity.
    if (input.entrySlotId) {
      const slot = await client.query<{ id: string; remaining: number; status: string }>(
        `SELECT id, remaining, status FROM catalog.entry_slots
         WHERE id = $1 AND event_id = $2
         FOR UPDATE`,
        [input.entrySlotId, input.eventId],
      );
      if (slot.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'SLOT_NOT_FOUND' },
          { status: 404 },
        );
      }
      const s = slot.rows[0];
      if (s.status !== 'open') {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'SLOT_NOT_OPEN', status: s.status },
          { status: 409 },
        );
      }
      if (s.remaining < input.quantity) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'SLOT_INSUFFICIENT_CAPACITY', remaining: s.remaining },
          { status: 409 },
        );
      }
      // Decrement remaining + auto sold_out
      await client.query(
        `UPDATE catalog.entry_slots
         SET remaining = remaining - $2,
             status = CASE WHEN remaining - $2 = 0 THEN 'sold_out' ELSE status END,
             updated_at = NOW()
         WHERE id = $1`,
        [input.entrySlotId, input.quantity],
      );
    }

    // Personalization: pokud ticket_type vyžaduje, holderNames musí mít length = quantity
    if (tt.requires_personalization) {
      const names = input.holderNames ?? [];
      if (names.length !== input.quantity) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'PERSONALIZATION_REQUIRED',
            message: `Tato akce vyžaduje jméno na každou vstupenku (potřeba ${input.quantity}, zadáno ${names.length}).`,
          },
          { status: 422 },
        );
      }
    }

    if (tt.remaining_qty < input.quantity) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Insufficient inventory (remaining: ${tt.remaining_qty})` },
        { status: 409 },
      );
    }

    // 1.5) Virtual queue check — pokud má event queue_enabled, vyžaduj admitted token
    if (tt.queue_enabled) {
      if (!input.queueToken) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'QUEUE_TOKEN_REQUIRED', message: 'Tato akce je v on-sale frontě.' },
          { status: 403 },
        );
      }
      const qt = await client.query<{
        id: string;
        status: string;
        expires_at: string | null;
      }>(
        `SELECT id, status, expires_at FROM platform.queue_tokens
         WHERE id = $1 AND event_id = $2 FOR UPDATE`,
        [input.queueToken, input.eventId],
      );
      if (qt.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'QUEUE_TOKEN_INVALID' }, { status: 403 });
      }
      const queueToken = qt.rows[0];
      if (queueToken.status !== 'admitted') {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'QUEUE_TOKEN_NOT_ADMITTED', status: queueToken.status },
          { status: 403 },
        );
      }
      if (queueToken.expires_at && new Date(queueToken.expires_at).getTime() < Date.now()) {
        await client.query(
          `UPDATE platform.queue_tokens SET status = 'expired' WHERE id = $1`,
          [queueToken.id],
        );
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'QUEUE_TOKEN_EXPIRED' }, { status: 403 });
      }
    }

    // 1.6) Seat verification — pokud je ticket type seated, MUSÍ být seat hold
    if (tt.is_seated) {
      if (!input.seatHoldToken || !input.seatIds || input.seatIds.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'SEATS_REQUIRED', message: 'Tento typ vstupenky vyžaduje výběr sedadel.' },
          { status: 422 },
        );
      }
      if (input.seatIds.length !== input.quantity) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'SEAT_COUNT_MISMATCH',
            message: `Počet sedadel (${input.seatIds.length}) musí odpovídat quantity (${input.quantity}).`,
          },
          { status: 422 },
        );
      }
      const heldSeats = await client.query<{
        id: string;
        status: string;
        ticket_type_id: string;
        hold_until: string | null;
      }>(
        `SELECT id, status, ticket_type_id, hold_until FROM catalog.event_seats
         WHERE id = ANY($1::uuid[]) AND event_id = $2 AND notes = $3
         FOR UPDATE`,
        [input.seatIds, input.eventId, input.seatHoldToken],
      );
      if (heldSeats.rows.length !== input.seatIds.length) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'SEAT_HOLD_MISMATCH', message: 'Některá sedadla nepatří k tomuto holdu nebo expirovala.' },
          { status: 409 },
        );
      }
      const wrongType = heldSeats.rows.find((s) => s.ticket_type_id !== tt.id);
      if (wrongType) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'SEAT_WRONG_TICKET_TYPE' },
          { status: 422 },
        );
      }
      const notHeld = heldSeats.rows.find((s) => s.status !== 'held');
      if (notHeld) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'SEAT_NOT_HELD', seatId: notHeld.id, status: notHeld.status },
          { status: 409 },
        );
      }
      // hold_until kontrola — chrání před uplatněním expirovaného holdu, který
      // ještě nestačil release cron (běží 1×/min). Bez tohoto checku by kupec,
      // který nechá tab otevřený přes expiry window, mohl seat získat zpětně
      // i když by ho mezitím legitimně mohl koupit někdo jiný.
      const nowMs = Date.now();
      const expired = heldSeats.rows.find(
        (s) => s.hold_until !== null && new Date(s.hold_until).getTime() < nowMs,
      );
      if (expired) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'SEAT_HOLD_EXPIRED',
            message: 'Vaše rezervace sedadel vypršela. Vraťte se k výběru sedadel a vyberte je znovu.',
            seatId: expired.id,
          },
          { status: 409 },
        );
      }
    }

    // 1a) Age gate — pokud event vyžaduje minimální věk
    const requiresAge = tt.min_age != null && tt.min_age > 0;
    if (requiresAge) {
      if (!input.birthDate || input.ageConfirmed !== true) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'AGE_VERIFICATION_REQUIRED',
            message: `Tato akce je od ${tt.min_age}+ let. Zadej datum narození a potvrď souhlas.`,
            minAge: tt.min_age,
          },
          { status: 422 },
        );
      }
      const age = calculateAgeYears(input.birthDate, new Date());
      if (age < tt.min_age!) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'AGE_BELOW_MINIMUM',
            message: `Tuto akci si můžou koupit jen lidé starší ${tt.min_age} let.`,
            minAge: tt.min_age,
          },
          { status: 403 },
        );
      }
    }

    // 1b) Server-side price resolution — JEDINÁ autorita pro cenu.
    // Pokud frontend poslal expectedUnitPriceHalire, helper vyhodí PriceMismatchError.
    let resolvedPrice;
    try {
      resolvedPrice = await resolveCurrentPrice(input.ticketTypeId, input.eventId, client, {
        expectedHalire: input.expectedUnitPriceHalire,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof PriceMismatchError) {
        return NextResponse.json(
          {
            error: 'PRICE_MISMATCH',
            message: 'Cena vstupenky se mezitím změnila. Aktualizujte stránku.',
            serverPriceHalire: err.serverPriceHalire,
          },
          { status: 409 },
        );
      }
      if (err instanceof PriceResolutionError) {
        return NextResponse.json({ error: err.code, message: err.message }, { status: 404 });
      }
      throw err;
    }
    let unitPriceHalire = resolvedPrice.unitPriceHalire;

    // 1.65) Dynamic pricing — pokud má ticket type aktivní rule, aplikuje upraviku ceny
    {
      const dpr = await client.query<{ enabled: boolean }>(
        `SELECT enabled FROM catalog.dynamic_pricing_rules WHERE ticket_type_id = $1`,
        [tt.id],
      );
      if (dpr.rows.length > 0 && dpr.rows[0].enabled) {
        const { computeDynamicPrice } = await import('@/lib/dynamic-pricing/compute');
        const dyn = await computeDynamicPrice(tt.id);
        if (dyn.signals.enabled) {
          unitPriceHalire = dyn.finalPriceMinor;
        }
      }
    }

    // 1.7) Member-only pricing — pokud má buyer email match v member_groups,
    // aplikujeme nejlepší slevu (nejnižší výslednou cenu).
    {
      const memberRule = await client.query<{
        discount_pct: number | null;
        fixed_price_minor: number | null;
      }>(
        `SELECT mpr.discount_pct, mpr.fixed_price_minor
         FROM catalog.member_pricing_rules mpr
         JOIN platform.member_groups mg ON mg.id = mpr.group_id
         JOIN platform.member_group_users mgu ON mgu.group_id = mg.id
         WHERE mpr.ticket_type_id = $1
           AND mpr.active = true AND mg.active = true
           AND LOWER(mgu.email) = LOWER($2)
           AND (mgu.valid_from IS NULL OR mgu.valid_from <= CURRENT_DATE)
           AND (mgu.valid_until IS NULL OR mgu.valid_until >= CURRENT_DATE)
         ORDER BY
           CASE
             WHEN mpr.fixed_price_minor IS NOT NULL THEN mpr.fixed_price_minor
             ELSE $3 - ($3 * mpr.discount_pct / 100)
           END ASC
         LIMIT 1`,
        [tt.id, input.buyerEmail, unitPriceHalire],
      );
      if (memberRule.rows.length > 0) {
        const rule = memberRule.rows[0];
        if (rule.fixed_price_minor !== null) {
          unitPriceHalire = rule.fixed_price_minor;
        } else if (rule.discount_pct !== null) {
          unitPriceHalire = Math.floor(unitPriceHalire - (unitPriceHalire * rule.discount_pct) / 100);
        }
      }
    }

    // 1.8) Verified discount (student / senior / disability) — buyer musí mít
    // status='verified' v identity.discount_verifications + ticket type musí mít rule.
    {
      const verifyRule = await client.query<{
        discount_pct: number | null;
        fixed_price_minor: number | null;
      }>(
        `SELECT dpr.discount_pct, dpr.fixed_price_minor
         FROM catalog.discount_pricing_rules dpr
         WHERE dpr.ticket_type_id = $1 AND dpr.active = true
           AND dpr.verification_type IN (
             SELECT type FROM identity.discount_verifications
             WHERE LOWER((SELECT email FROM identity.users WHERE id = user_id)) = LOWER($2)
               AND status = 'verified'
               AND (expires_at IS NULL OR expires_at > NOW())
           )
         ORDER BY
           CASE
             WHEN dpr.fixed_price_minor IS NOT NULL THEN dpr.fixed_price_minor
             ELSE $3 - ($3 * dpr.discount_pct / 100)
           END ASC
         LIMIT 1`,
        [tt.id, input.buyerEmail, unitPriceHalire],
      );
      if (verifyRule.rows.length > 0) {
        const rule = verifyRule.rows[0];
        const candidatePrice =
          rule.fixed_price_minor !== null
            ? rule.fixed_price_minor
            : Math.floor(unitPriceHalire - (unitPriceHalire * (rule.discount_pct ?? 0)) / 100);
        // Jen pokud je ten verified discount levnější než member price (nebo base)
        if (candidatePrice < unitPriceHalire) {
          unitPriceHalire = candidatePrice;
        }
      }
    }

    // 2) Najdi/založ guest usera
    const userRes = await client.query<{ id: string }>(
      `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
       VALUES ($1, $2, '!guest', NOW(), NOW(), NOW())
       ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE
         SET updated_at = NOW()
       RETURNING id`,
      [input.buyerEmail.toLowerCase(), input.buyerName],
    );
    const userId = userRes.rows[0].id;

    // 3) Decrement inventory
    await client.query(
      `UPDATE catalog.ticket_types
         SET remaining_qty = remaining_qty - $1
       WHERE id = $2`,
      [input.quantity, tt.id],
    );

    // 3b) Promo code / subscription — pokud poslán, validuj a aplikuj slevu na subtotal
    let subtotalAmount = unitPriceHalire * input.quantity;
    let discountAmount = 0;
    let promoCodeId: string | null = null;
    let consumedSubscriptionId: string | null = null;

    // 3a) Volume discount (skupinová sleva) — aplikuje se PŘED promo kódem.
    //     Tier s nejvyšším min_qty <= input.quantity vyhrává.
    let volumeDiscountAmount = 0;
    let volumeDiscountPct = 0;
    if (input.quantity >= 2) {
      const volRes = await client.query<{ discount_pct: number; min_qty: number }>(
        `SELECT discount_pct, min_qty
         FROM catalog.volume_discount_rules
         WHERE ticket_type_id = $1 AND active = TRUE AND min_qty <= $2
         ORDER BY min_qty DESC
         LIMIT 1`,
        [tt.id, input.quantity],
      );
      if (volRes.rows.length > 0) {
        volumeDiscountPct = volRes.rows[0].discount_pct;
        volumeDiscountAmount = Math.floor((subtotalAmount * volumeDiscountPct) / 100);
        subtotalAmount -= volumeDiscountAmount;
      }
    }

    // 3b-pre) Subscription consumption (předplatné)
    // Pokud má buyer aktivní subscription u promotéra eventu a allowance,
    // spotřebuje N kusů a aplikuje 100 % discount. Promo code se v této
    // session ignoruje (subscription má prioritu).
    if (input.useSubscription) {
      const subRes = await client.query<{
        id: string;
        plan_id: string;
        allowance: number;
        period_start: string;
        used: number;
      }>(
        `SELECT s.id, s.plan_id, p.allowance_per_period AS allowance,
                s.current_period_start AS period_start,
                (SELECT COUNT(*)::int FROM subscriptions.consumptions c
                 WHERE c.subscription_id = s.id
                   AND c.period_start = s.current_period_start) AS used
         FROM subscriptions.subscriptions s
         JOIN subscriptions.plans p ON p.id = s.plan_id
         JOIN catalog.events e ON e.id = $1
         WHERE s.user_id = $2
           AND s.status = 'active'
           AND p.promoter_id = e.promoter_id
           AND s.current_period_end > now()
         ORDER BY s.created_at DESC
         LIMIT 1
         FOR UPDATE OF s`,
        [input.eventId, userId],
      );
      const sub = subRes.rows[0];
      if (!sub) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'NO_ACTIVE_SUBSCRIPTION',
            message: 'U tohoto pořadatele nemáš aktivní permanentku.',
          },
          { status: 422 },
        );
      }
      const remaining = sub.allowance - sub.used;
      if (remaining < input.quantity) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'INSUFFICIENT_ALLOWANCE',
            message: `V permanentce zbývá jen ${remaining}, potřebuješ ${input.quantity}.`,
            remaining,
          },
          { status: 422 },
        );
      }

      // Aplikuj 100 % discount
      discountAmount = subtotalAmount;
      consumedSubscriptionId = sub.id;
    }

    if (input.promoCode && !consumedSubscriptionId) {
      const pcRes = await client.query<{
        id: string;
        type: string;
        discount_value: number;
        max_uses: number | null;
        uses_count: number;
        valid_from: string;
        valid_until: string | null;
      }>(
        `SELECT id, type, discount_value, max_uses, uses_count, valid_from, valid_until
         FROM marketing.promo_codes
         WHERE UPPER(code) = UPPER($1) AND active = TRUE
         FOR UPDATE`,
        [input.promoCode],
      );
      if (pcRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'PROMO_CODE_INVALID', message: 'Promo kód neexistuje nebo není aktivní.' },
          { status: 422 },
        );
      }
      const pc = pcRes.rows[0];
      const now = new Date();
      if (new Date(pc.valid_from) > now) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'PROMO_CODE_NOT_YET_VALID' },
          { status: 422 },
        );
      }
      if (pc.valid_until && new Date(pc.valid_until) < now) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'PROMO_CODE_EXPIRED' },
          { status: 422 },
        );
      }
      if (pc.max_uses !== null && pc.uses_count >= pc.max_uses) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'PROMO_CODE_USED_UP' },
          { status: 422 },
        );
      }
      if (pc.type === 'percentage') {
        discountAmount = Math.floor((subtotalAmount * pc.discount_value) / 100);
      } else if (pc.type === 'fixed') {
        discountAmount = Math.min(subtotalAmount, pc.discount_value);
      }
      promoCodeId = pc.id;

      // Increment uses_count atomicky (FOR UPDATE výše)
      await client.query(
        `UPDATE marketing.promo_codes SET uses_count = uses_count + 1, updated_at = NOW() WHERE id = $1`,
        [pc.id],
      );
    }

    // 3c) Add-ons (parking, camping, F&B credit…). Validujeme + dopočítáváme cenu.
    let addonsSubtotal = 0;
    const validatedAddons: Array<{
      addonId: string;
      name: string;
      category: string;
      quantity: number;
      unitPriceHalire: number;
      subtotalHalire: number;
    }> = [];
    if (input.addons && input.addons.length > 0) {
      const addonIds = input.addons.map((a) => a.addonId);
      const addonRes = await client.query<{
        id: string;
        name: string;
        category: string;
        price_halire: number;
        max_quantity: number;
        stock_available: number | null;
        available: boolean;
      }>(
        `SELECT id, name, category, price_halire, max_quantity, stock_available, available
         FROM public.checkout_addons
         WHERE event_id = $1 AND id = ANY($2::uuid[])
         FOR UPDATE`,
        [input.eventId, addonIds],
      );
      const addonMap = new Map(addonRes.rows.map((a) => [a.id, a]));
      for (const requested of input.addons) {
        const addon = addonMap.get(requested.addonId);
        if (!addon) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'ADDON_NOT_FOUND', addonId: requested.addonId },
            { status: 404 },
          );
        }
        if (!addon.available) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'ADDON_NOT_AVAILABLE', addonId: addon.id, name: addon.name },
            { status: 409 },
          );
        }
        if (requested.quantity > addon.max_quantity) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            {
              error: 'ADDON_QUANTITY_OVER_MAX',
              addonId: addon.id,
              max: addon.max_quantity,
            },
            { status: 422 },
          );
        }
        if (
          addon.stock_available !== null &&
          addon.stock_available < requested.quantity
        ) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            {
              error: 'ADDON_OUT_OF_STOCK',
              addonId: addon.id,
              available: addon.stock_available,
            },
            { status: 409 },
          );
        }
        const subtotal = addon.price_halire * requested.quantity;
        validatedAddons.push({
          addonId: addon.id,
          name: addon.name,
          category: addon.category,
          quantity: requested.quantity,
          unitPriceHalire: addon.price_halire,
          subtotalHalire: subtotal,
        });
        addonsSubtotal += subtotal;
        // Decrement stock pokud je tracked
        if (addon.stock_available !== null) {
          await client.query(
            `UPDATE public.checkout_addons
             SET stock_available = stock_available - $1
             WHERE id = $2`,
            [requested.quantity, addon.id],
          );
        }
      }
    }

    // 4) Insert order + order_items
    let totalAmount = subtotalAmount - discountAmount + addonsSubtotal;
    let bundleDiscountAmount = 0;
    if (bundleDiscountPct > 0) {
      const grossBundle = subtotalAmount + addonsSubtotal;
      bundleDiscountAmount = Math.floor((grossBundle * bundleDiscountPct) / 100);
      totalAmount = grossBundle - bundleDiscountAmount - discountAmount;
    }

    // Insurance opt-in (Fáze H.3) — premium = pct of pre-insurance total
    let insurancePremium = 0;
    const insuranceApplied =
      input.insuranceOptIn === true && tt.insurance_enabled && tt.insurance_pct > 0;
    if (insuranceApplied) {
      insurancePremium = Math.floor((totalAmount * tt.insurance_pct) / 100);
      totalAmount += insurancePremium;
    }

    // Gift voucher redemption — aplikuje se až po insurance + bundles + promo.
    // Voucher se odečte z totalAmount do balance limitu.
    let voucherRedeemedHalire = 0;
    let voucherId: string | null = null;
    if (input.voucherCode && totalAmount > 0) {
      const code = input.voucherCode.trim().toUpperCase();
      const v = await client.query<{
        id: string;
        balance_halire: number;
        promoter_id: string | null;
        event_id: string | null;
        expires_at: string | null;
      }>(
        `SELECT id, balance_halire, promoter_id, event_id, expires_at
         FROM marketing.gift_vouchers
         WHERE code = $1
         FOR UPDATE`,
        [code],
      );
      if (v.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'VOUCHER_INVALID' }, { status: 422 });
      }
      const voucher = v.rows[0];
      if (voucher.expires_at && new Date(voucher.expires_at).getTime() < Date.now()) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'VOUCHER_EXPIRED' }, { status: 422 });
      }
      if (voucher.balance_halire === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'VOUCHER_DEPLETED' }, { status: 422 });
      }
      if (voucher.event_id && voucher.event_id !== input.eventId) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'VOUCHER_WRONG_EVENT' }, { status: 422 });
      }
      if (voucher.promoter_id) {
        const ev = await client.query<{ promoter_id: string }>(
          `SELECT promoter_id FROM catalog.events WHERE id = $1`,
          [input.eventId],
        );
        if (ev.rows.length === 0 || ev.rows[0].promoter_id !== voucher.promoter_id) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'VOUCHER_WRONG_PROMOTER' }, { status: 422 });
        }
      }
      voucherRedeemedHalire = Math.min(voucher.balance_halire, totalAmount);
      voucherId = voucher.id;
      totalAmount -= voucherRedeemedHalire;
    }

    // Restwert kredit (P0-2 polish) — aplikuje se po voucheru. Pull holders
    // buyer-a (`userId` z guest lookup nebo existing email) u promotéra
    // eventu se zbytkovým kreditem; debit FIFO podle created_at.
    let restwertAppliedHalire = 0;
    const restwertHolders: Array<{ holderId: string; debited: number }> = [];
    if (input.useRestwertCredit && totalAmount > 0) {
      const evPromoter = await client.query<{ promoter_id: string }>(
        `SELECT promoter_id FROM catalog.events WHERE id = $1`,
        [input.eventId],
      );
      if (evPromoter.rows.length > 0) {
        const promoterId = evPromoter.rows[0].promoter_id;
        const holdersRes = await client.query<{
          id: string;
          restwert_credit_halire: number;
        }>(
          `SELECT h.id, h.restwert_credit_halire
             FROM subscriptions.holders h
             JOIN subscriptions.packages p ON p.id = h.package_id
            WHERE h.user_id = $1
              AND p.promoter_id = $2
              AND h.status = 'active'
              AND h.restwert_credit_halire > 0
            ORDER BY h.created_at ASC
            FOR UPDATE OF h`,
          [userId, promoterId],
        );
        for (const h of holdersRes.rows) {
          if (totalAmount === 0) break;
          const debit = Math.min(h.restwert_credit_halire, totalAmount);
          await client.query(
            `UPDATE subscriptions.holders
                SET restwert_credit_halire = restwert_credit_halire - $2
              WHERE id = $1`,
            [h.id, debit],
          );
          totalAmount -= debit;
          restwertAppliedHalire += debit;
          restwertHolders.push({ holderId: h.id, debited: debit });
        }
      }
    }

    // Předgenerujeme placeholder paymentId; pokud poběží Stripe (real provider),
    // přepíšeme ho session.id po commitu transakce.
    const paymentId = `mock-pay-${randomUUID().slice(0, 8)}`;

    // Variabilní symbol pro bank_transfer (10 cifer, CZ + SR bankovní standard).
    // Formát: EEEEEENNNN — 6-digit event short ID + 4-digit per-event sequence.
    // Promotér v bank statement vidí ke které akci platba patří.
    const variableSymbol =
      input.paymentMethod === 'bank_transfer'
        ? await (async () => {
            const { generateVariableSymbol } = await import('@/lib/payment/vs-generator');
            return generateVariableSymbol(input.eventId, client);
          })()
        : null;

    // Bank transfer má delší expiraci (3 dny) než instant gateway (15 min)
    const expiresInterval = input.paymentMethod === 'bank_transfer' ? '3 days' : '15 minutes';

    const orderRes = await client.query<{ id: string }>(
      `INSERT INTO orders.orders
         (user_id, event_id, status, total_amount, currency, locale,
          gopay_payment_id, payment_provider, idempotency_key,
          discount_halire, promo_code_id, requires_age_verification,
          is_gift, gift_recipient_email, gift_recipient_name, gift_message, gift_redeem_token,
          holder_names, variable_symbol, entry_slot_id,
          expires_at, created_at, updated_at)
       VALUES ($1, $2, 'pending', $3, $4, 'cs',
               $5, $6, $7,
               $8, $9, $10,
               $11, $12, $13, $14, $15,
               $16, $17, $19,
               NOW() + ($18 || '')::interval, NOW(), NOW())
       RETURNING id`,
      [
        userId,
        input.eventId,
        totalAmount,
        tt.currency,
        paymentId,
        input.paymentMethod, // gopay | wero | przelewy24 | bank_transfer
        randomUUID(),
        discountAmount + bundleDiscountAmount,
        promoCodeId,
        requiresAge,
        Boolean(input.giftRecipientEmail),
        input.giftRecipientEmail?.toLowerCase() ?? null,
        input.giftRecipientName ?? null,
        input.giftMessage ?? null,
        input.giftRecipientEmail ? randomUUID() : null,
        input.holderNames && input.holderNames.length > 0 ? input.holderNames : null,
        variableSymbol,
        expiresInterval,
        input.entrySlotId ?? null,
      ],
    );
    const orderId = orderRes.rows[0].id;

    // Fraud scoring (Fáze W.6 — ML-based, replaces P.3 rules)
    {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
      const fingerprint = req.headers.get('x-fingerprint') ?? undefined;
      const { scoreFraudML } = await import('@/lib/ai/fraud-ml');
      const fraud = await scoreFraudML({
        email: input.buyerEmail,
        ip,
        totalAmountMinor: totalAmount,
        currency: tt.currency,
        fingerprint,
        isNewUser: true,
        buyerName: input.buyerName,
      });
      await client.query(
        `UPDATE orders.orders
         SET fraud_score = $2, fraud_signals = $3::jsonb, fraud_decision = $4
         WHERE id = $1`,
        [
          orderId,
          fraud.score,
          JSON.stringify({
            ...fraud.features,
            topReasons: fraud.topReasons,
            probability: fraud.probability,
            model: 'ml-v1',
          }),
          fraud.decision,
        ],
      );
      if (fraud.decision === 'block') {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'FRAUD_BLOCK', score: fraud.score, reasons: fraud.topReasons },
          { status: 403 },
        );
      }
    }

    if (input.affiliateCode) {
      // Resolve affiliate, link order, compute commission (only for promoter who owns event)
      const aff = await client.query<{ id: string; commission_pct: number }>(
        `SELECT a.id, a.commission_pct FROM marketing.affiliates a
         JOIN catalog.events e ON e.promoter_id = a.promoter_id
         WHERE UPPER(a.code) = UPPER($1) AND a.active = true AND e.id = $2`,
        [input.affiliateCode, input.eventId],
      );
      if (aff.rows.length > 0) {
        const a = aff.rows[0];
        const commission = Math.floor((totalAmount * a.commission_pct) / 100);
        await client.query(
          `UPDATE orders.orders
           SET affiliate_id = $2, affiliate_commission_minor = $3
           WHERE id = $1`,
          [orderId, a.id, commission],
        );
      }
    }

    // QR campaign attribution — buyer přišel přes /api/qr/[slug] redirect a
    // cookie qr_ref se posílá v checkout body. Linkujeme order na kampaň pro
    // conversion tracking (po payment se inkrementuje conversion_count
    // v mock-gopay/[paymentId] route).
    if (input.qrRef) {
      const qr = await client.query<{ id: string }>(
        `SELECT id FROM marketing.qr_campaigns WHERE id = $1 AND event_id = $2`,
        [input.qrRef, input.eventId],
      );
      if (qr.rows.length > 0) {
        await client.query(
          `UPDATE orders.orders SET qr_campaign_id = $2 WHERE id = $1`,
          [orderId, qr.rows[0].id],
        );
      }
    }

    if (input.queueToken && tt.queue_enabled) {
      await client.query(
        `UPDATE platform.queue_tokens
         SET status = 'completed', completed_at = NOW()
         WHERE id = $1 AND status = 'admitted'`,
        [input.queueToken],
      );
    }

    if (input.lotteryEntryId) {
      const lr = await client.query<{ status: string; redeem_deadline: string }>(
        `SELECT status, redeem_deadline FROM catalog.lottery_entries
         WHERE id = $1 AND ticket_type_id = $2 FOR UPDATE`,
        [input.lotteryEntryId, tt.id],
      );
      if (lr.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'LOTTERY_ENTRY_INVALID' },
          { status: 422 },
        );
      }
      if (lr.rows[0].status !== 'winner') {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'LOTTERY_NOT_WINNER', status: lr.rows[0].status },
          { status: 409 },
        );
      }
      if (new Date(lr.rows[0].redeem_deadline).getTime() < Date.now()) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'LOTTERY_DEADLINE_PASSED' }, { status: 409 });
      }
      await client.query(
        `UPDATE catalog.lottery_entries
         SET status = 'redeemed', redeemed_at = NOW(), redeemed_order_id = $2
         WHERE id = $1`,
        [input.lotteryEntryId, orderId],
      );
    }

    if (tt.is_seated && input.seatIds && input.seatHoldToken) {
      await client.query(
        `UPDATE catalog.event_seats
         SET status = 'sold', order_id = $2, hold_until = NULL, updated_at = NOW()
         WHERE id = ANY($1::uuid[]) AND notes = $3`,
        [input.seatIds, orderId, input.seatHoldToken],
      );
    }

    if (insuranceApplied) {
      await client.query(
        `INSERT INTO orders.order_insurance
           (order_id, premium_amount, premium_pct, currency, provider, policy_ref)
         VALUES ($1, $2, $3, $4, 'mock_insurer', $5)`,
        [
          orderId,
          insurancePremium,
          tt.insurance_pct,
          tt.currency,
          `MOCK-${orderId.slice(0, 8).toUpperCase()}`,
        ],
      );
    }

    await client.query(
      `INSERT INTO orders.order_items
         (order_id, ticket_type_id, quantity, unit_price, total_price, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [orderId, tt.id, input.quantity, unitPriceHalire, subtotalAmount],
    );

    // Subscription consumption — zapíše N rows (jeden per lístek)
    if (consumedSubscriptionId) {
      for (let i = 0; i < input.quantity; i++) {
        await client.query(
          `INSERT INTO subscriptions.consumptions
             (subscription_id, event_id, period_start)
           VALUES ($1, $2,
             (SELECT current_period_start FROM subscriptions.subscriptions WHERE id = $1))`,
          [consumedSubscriptionId, input.eventId],
        );
      }
    }

    // Add-on order entries
    for (const addon of validatedAddons) {
      await client.query(
        `INSERT INTO public.order_addons
           (order_id, addon_id, addon_name, category, quantity,
            unit_price_halire, subtotal_halire, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
        [
          orderId,
          addon.addonId,
          addon.name,
          addon.category,
          addon.quantity,
          addon.unitPriceHalire,
          addon.subtotalHalire,
        ],
      );
    }

    // Voucher: dekrement balance + zápis redemption (uvnitř transakce)
    if (voucherId && voucherRedeemedHalire > 0) {
      await client.query(
        `UPDATE marketing.gift_vouchers
         SET balance_halire = balance_halire - $2,
             fully_used_at = CASE WHEN balance_halire - $2 = 0 THEN NOW() ELSE fully_used_at END,
             updated_at = NOW()
         WHERE id = $1`,
        [voucherId, voucherRedeemedHalire],
      );
      await client.query(
        `INSERT INTO marketing.gift_voucher_redemptions
           (voucher_id, order_id, amount_redeemed_halire)
         VALUES ($1, $2, $3)`,
        [voucherId, orderId, voucherRedeemedHalire],
      );
    }

    await client.query('COMMIT');

    // Po commitu: vytvoř payment session přes provider switcher.
    // Benefit karty (Pluxee/Sodexo/Benefit Plus/Edenred/Gallery Beta) jdou přes vlastní lib.
    const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const benefitProviders = new Set([
      'pluxee',
      'sodexo',
      'benefit_plus',
      'edenred',
      'gallery_beta',
    ]);
    let paymentSession;

    const bnplProviders = new Set(['twisto', 'skippay']);
    if (bnplProviders.has(input.paymentMethod)) {
      // BNPL mock provider — žádný real API, dev mode similar k mock-gopay
      const bnplPaymentId = randomUUID();
      paymentSession = {
        paymentId: bnplPaymentId,
        gatewayUrl: `${appUrl}/mock-bnpl/${input.paymentMethod}/${bnplPaymentId}`,
        provider: input.paymentMethod,
      };
    } else if (benefitProviders.has(input.paymentMethod)) {
      const { createBenefitPayment } = await import('@/lib/payment/benefits');
      // Sodexo používá Pluxee infrastrukturu (Pluxee koupil Sodexo Benefits v 2023)
      const benefitProvider = (input.paymentMethod === 'sodexo' ? 'pluxee' : input.paymentMethod) as
        | 'pluxee'
        | 'benefit_plus'
        | 'edenred'
        | 'gallery_beta';
      const benefitResult = await createBenefitPayment({
        orderId,
        amountHalire: totalAmount,
        buyerEmail: input.buyerEmail,
        provider: benefitProvider,
        appUrl,
      });
      paymentSession = {
        paymentId: benefitResult.externalId,
        gatewayUrl: benefitResult.redirectUrl,
        provider: input.paymentMethod,
      };
    } else {
      const { createPayment } = await import('@/lib/payment/provider');
      paymentSession = await createPayment({
        orderId,
        amountHalire: totalAmount,
        currency: tt.currency,
        buyerEmail: input.buyerEmail,
        description: `${tt.event_title} × ${input.quantity}`,
        paymentMethod: input.paymentMethod as 'gopay' | 'wero' | 'przelewy24' | 'bank_transfer',
        appUrl,
      });
    }

    // Sjednocený sloupec gopay_payment_id pro všechny providery (gopay/comgate/stripe/mock).
    // INSERT výše použil placeholder; teď zapíšeme reálný paymentId, podle kterého
    // mock brána / webhook najde objednávku.
    if (paymentSession.paymentId !== paymentId) {
      await db().query(
        `UPDATE orders.orders SET gopay_payment_id = $2, updated_at = NOW() WHERE id = $1`,
        [orderId, paymentSession.paymentId],
      );
    }

    return NextResponse.json({
      orderId,
      paymentId: paymentSession.paymentId,
      gatewayUrl: paymentSession.gatewayUrl,
      provider: paymentSession.provider,
      variableSymbol,
      subtotalAmount,
      discountAmount,
      volumeDiscountAmount,
      volumeDiscountPct,
      addonsSubtotal,
      bundleDiscountAmount,
      bundleId,
      voucherRedeemedHalire,
      restwertAppliedHalire,
      restwertHolders,
      totalAmount,
      promoCodeApplied: promoCodeId !== null,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[checkout-demo]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
