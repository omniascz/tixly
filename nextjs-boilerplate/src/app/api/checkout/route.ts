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
import { z } from 'zod';

import { calculateAgeYears } from '@/lib/age/calculate';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import {
  resolveCurrentPrice,
  PriceMismatchError,
  PriceResolutionError,
} from '@/lib/pricing/resolve-price';
import { validateVatNumber, isReverseChargeApplicable } from '@/lib/tax/vies';


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
  // EUDI (mig 446) — requestId dokončeného ověření peněženkou (vyžadováno jen u akcí
  // s eudi_required a NAKONFIGUROVANÝM verifierem; jinak se ignoruje).
  eudiRequestId: z.string().min(10).max(200).optional(),
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
      'multisport',
      // BNPL providers (CZ priority #2): Twisto (Mastercard owned, 1M+ CZ
      // users), Skip Pay (ČSOB). Mock mode → /mock-bnpl/[provider]/[paymentId]
      // gateway URL podobně jak benefit pay.
      'twisto',
      'skippay',
      // B2B kreditní účet — firma deposituje kredit, zaměstnanci nakupují
      // bez individuální platby. Žádná platební brána, jen debit z balance.
      'b2b_credit',
      // International gateways
      'mollie',   // NL/BE/FR — iDEAL, Bancontact, SEPA, Klarna, PayPal via Mollie
      'paypal',   // DE/AT/FR/Global — standalone PayPal Orders API v2
      // Krypto (AXS parity) — Bitcoin/Ethereum přes Triple-A. Mock brána
      // /mock-crypto/[paymentId] v dev mode (real API vyžaduje TRIPLEA_API_KEY).
      'crypto',
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
  // B2B kreditní účet — kód firemního účtu (povinný pokud paymentMethod='b2b_credit').
  b2bAccountCode: z.string().min(4).max(20).optional(),
  // Gift voucher kód — aplikuje se PO promo kódu jako přímá sleva z balance.
  voucherCode: z.string().min(8).max(40).optional(),
  // Gift karta (mig 431) — platform-wide prepaid hodnota. Kód GK-XXXXXXXX.
  // Aplikuje se po voucheru, před service fee.
  giftCardCode: z.string().min(4).max(20).optional(),
  // Restwert kredit (DACH P0-2 Q4 polish) — buyer uplatní zbytkový kredit ze
  // svých subscriptions.holders u téhož promotéra. Aplikuje se PO voucheru.
  // Vyžaduje x-user-id header (přihlášený buyer; guest nemá historii).
  useRestwertCredit: z.boolean().optional(),
  // OTP token z /api/buyer/otp/verify — povinný pokud events.requires_otp_validation=true.
  // CZ priority #3 — anti-bot ochrana top eventů (Karel Gott reissue, festival
  // announcement).
  otpToken: z.string().min(20).max(80).optional(),
  // Verified Fan presale code (CZ priority #4) — admin bulk-approve generuje
  // PSL-xxxx kódy, fan ho dostane emailem, použije v checkout body pokud má
  // event verified_fan_enabled. Po úspěšném order INSERT se code označí jako
  // used_order_id v marketing.verified_fan_requests.
  presaleCode: z.string().min(4).max(40).optional(),
  // Loyalty points redemption (CZ priority #6) — buyer uplatní existing
  // loyalty body. 1 bod = 1 Kč sleva, max 50% z subtotal.
  redeemLoyaltyPoints: z.number().int().min(0).max(100_000).optional(),
  // Group invitation token (CZ priority #5) — friend přišel přes share link.
  // Order se napojí na group_invitation pro "X z N already paid" tracking.
  groupInvitationToken: z.string().min(20).max(80).optional(),
  // Marketing QR kampaň ID — buyer přišel přes QR z plakátu/letáku.
  // Cookie qr_ref se zapíše po /api/qr/[slug] redirectu, client ho posílá.
  qrRef: z.string().uuid().optional(),
  // Foyer pre-order (mig 359) — nápoje/jídlo z foyer baru na přestávku.
  // Vloží se do orders.foyer_orders linked na orderId po COMMITU tiketů.
  foyerItems: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(10),
      }),
    )
    .optional(),
  // Digitální program (mig 359) — buyer přikoupí přístup k programu events.
  addProgram: z.boolean().optional(),
  // EU B2B reverse charge (mig 390) — B2B kupec zadá DIČ/VAT ID.
  // Pokud je DIČ platné (VIES) a země kupce ≠ zemi pořadatele → 0% DPH, reverse charge.
  buyerVatNumber: z.string().min(4).max(20).regex(/^[A-Z]{2}[0-9A-Z]+$/i).optional(),
  buyerCompanyName: z.string().min(1).max(200).optional(),
  // EVENTIM.Travel (mig 414) — buyer přidá hotelový balíček k objednávce.
  // packageId musí patřit k danému eventu, kapacita se atomicky sníží.
  travelPackageId: z.string().uuid().optional(),
  travelGuests: z.number().int().min(1).max(10).optional(),
  travelNotes: z.string().max(300).optional(),
  // Postal delivery (mig 418) — fyzické doručení vstupenek poštou.
  deliveryMethod: z.enum(['digital', 'postal']).default('digital'),
  postalName: z.string().max(200).optional(),
  postalAddressLine1: z.string().max(200).optional(),
  postalCity: z.string().max(100).optional(),
  postalPostalCode: z.string().max(20).optional(),
  postalCountry: z.string().length(2).optional(),
  // Carbon offset (mig 421) — dobrovolný příplatek na kompenzaci CO₂ emisí.
  carbonOffsetOptIn: z.boolean().optional(),
  // Parking bundle (mig 402) — přikoupení parkovacího místa ke vstupence.
  parkingOfferId: z.string().uuid().optional(),
  // Saved payment method (mig 429) — 1-click checkout s uloženou kartou.
  savedPaymentMethodId: z.string().uuid().optional(),
  // Splátkový plán (mig 094/232) — buyer zaplatí zálohu teď, zbytek v N splátkách.
  // planId musí patřit k danému eventu a být active=true.
  paymentPlanId: z.string().uuid().optional(),
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
  max_per_user: number | null;
  // mig 432 — presale access codes
  presale_starts_at: string | null;
  presale_ends_at: string | null;
  presale_code: string | null;
  presale_code_required: boolean;
  // mig 433 — purchase limit per ticket type
  max_per_buyer: number | null;
  // mig 433 — purchase limit per event (from events table)
  max_tickets_per_buyer: number | null;
}


// CORS preflight pro cross-origin embed/native prodejní integraci (guest checkout).
// CORS hlavičky doplní next.config (source '/api/checkout').
export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  // Early-guard: krypto bez nakonfigurovaného Triple-A nesmí v produkci založit
  // objednávku (mock-crypto je tam vypnutý → slepá 403 ulička). Fail-closed JEŠTĚ
  // PŘED vytvořením objednávky, aby nevznikaly mrtvé pending objednávky.
  if (input.paymentMethod === 'crypto') {
    const { getTripleAConfig } = await import('@/lib/payment/triplea');
    const { mockPaymentsAllowed } = await import('@/lib/payment/mock-guard');
    if (!getTripleAConfig().isConfigured && !mockPaymentsAllowed()) {
      return NextResponse.json(
        {
          error: 'PAYMENT_METHOD_UNAVAILABLE',
          message: 'Krypto platba není momentálně dostupná. Zvolte prosím jinou metodu.',
          provider: 'crypto',
        },
        { status: 503 },
      );
    }
  }

  // Early-guard: digitální program-booklet je DOČASNĚ NEDOSTUPNÝ (schema drift, třída 3 ORPHAN).
  // catalog.event_programs je v prod schématu ROZVRHOVÁ/timetable tabulka — booklet sloupce
  // (program_price_halire, is_published) NEEXISTUJÍ nikde. Post-commit blok níže by proto spadl
  // 42703 AŽ PO COMMITu objednávky (:2128) → buyer platí, dostane 500, objednávka drží inventář =
  // orphan. Fail-closed JEŠTĚ PŘED vytvořením objednávky (stejně jako crypto guard výše):
  // žádná objednávka, žádný orphan, čisté odmítnutí místo 42703-crashe. Z běžného UI addProgram
  // nikdy nepřijde (fieldset skryt); tohle je pojistka proti přímému API POST.
  // Znovuzapnutí = feature ticket "digitální program-booklet subsystém" (REMEDIATION.md).
  if (input.addProgram) {
    // 503 (ne 400) — sjednoceno s crypto guardem výše (PAYMENT_METHOD_UNAVAILABLE):
    // request není chybný, feature je dočasně nedostupná.
    return NextResponse.json(
      {
        error: 'PROGRAM_PURCHASE_UNAVAILABLE',
        message: 'Digitální program není momentálně dostupný.',
      },
      { status: 503 },
    );
  }

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
              tt.max_per_user,
              e.promoter_id, e.requires_otp_validation,
              COALESCE(e.require_phone_verified, FALSE) AS require_phone_verified,
              COALESCE(e.verified_fan_enabled, FALSE) AS verified_fan_enabled,
              e.verified_fan_presale_starts_at::text AS vf_starts_at,
              e.verified_fan_presale_ends_at::text AS vf_ends_at,
              tt.presale_starts_at::text AS presale_starts_at,
              tt.presale_ends_at::text AS presale_ends_at,
              tt.presale_code,
              COALESCE(tt.presale_code_required, FALSE) AS presale_code_required,
              tt.max_per_buyer,
              e.max_tickets_per_buyer,
              (to_jsonb(e.*) -> 'eudi_required') AS eudi_required
       FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
       WHERE tt.id = $1 AND tt.event_id = $2 AND e.status = 'published'`,
      // POZN. (concurrency): ŽÁDNÝ FOR UPDATE zde. Dřív se řádek ticket_type
      // zamykal na CELOU těžkou checkout transakci (fraud ML, slevy, inserty) →
      // pod onsale náporem se kupci serializovali na tomhle zámku a server tuhl.
      // Inventář se teď rezervuje atomicky až těsně před commitem (viz níže).
      [input.ticketTypeId, input.eventId],
    );
    if (ttRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Ticket type not found or event is not published' },
        { status: 404 },
      );
    }
    const tt = ttRes.rows[0] as { id: string; event_id: string; remaining_qty: number; name: string; event_title: string; min_age: number | null; currency: string; queue_enabled: boolean; insurance_enabled: boolean; insurance_pct: number; is_seated: boolean; requires_personalization: boolean; max_per_user: number | null; promoter_id: string; requires_otp_validation: boolean; require_phone_verified: boolean; verified_fan_enabled: boolean; vf_starts_at: string | null; vf_ends_at: string | null; presale_starts_at: string | null; presale_ends_at: string | null; presale_code: string | null; presale_code_required: boolean; max_per_buyer: number | null; max_tickets_per_buyer: number | null; eudi_required: { age18?: boolean; samePerson?: boolean; residency?: string | null } | null };

    // Verified Fan gate (CZ priority #4) — pokud event má VF enabled, jen
    // approved fans s unused presale_code mohou koupit. Po úspěšném zápisu
    // do orderu označíme code jako used_order_id (až po INSERT order).
    let verifiedFanRequestId: string | null = null;
    if (tt.verified_fan_enabled) {
      // Pokud existuje VF presale window a jsme MIMO něj, gate platí?
      // MVP: gate je vždy aktivní pokud verified_fan_enabled=true.
      // Promotér může window vymazat aby gate vypnul.
      if (!input.presaleCode) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'VERIFIED_FAN_REQUIRED',
            message: 'Tato akce je v presale módu. Vyžaduje Verified Fan presale_code.',
          },
          { status: 422 },
        );
      }
      const vfRes = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM marketing.verified_fan_requests
          WHERE presale_code = $1
            AND event_id = $2
            AND status = 'approved'
            AND used_order_id IS NULL
          FOR UPDATE`,
        [input.presaleCode.toUpperCase().trim(), input.eventId],
      );
      if (vfRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'PRESALE_CODE_INVALID',
            message: 'Presale kód není platný nebo už byl použit.',
          },
          { status: 422 },
        );
      }
      // TODO: ověř že code patří aktuálnímu userovi (anti-share na social).
      // Userid je resolved až později v checkout flow (line ~684 z lookup
      // buyer email → users.id), tak tady ho nemáme. Buď přesunout user
      // resolution výš, nebo akceptovat že code lze sdílet (MVP).
      verifiedFanRequestId = vfRes.rows[0].id;
    }

    // EUDI gate (mig 446) — CONFIG-GATED: vynucuje se JEN když je verifier reálně
    // nakonfigurovaný. Bez configu (na-klíč stav) se přeskočí → nezablokuje nákupy.
    const eudiReq = tt.eudi_required;
    const eudiNeeded = !!eudiReq && (eudiReq.age18 === true || eudiReq.samePerson === true || !!eudiReq.residency);
    if (eudiNeeded) {
      const { eudiConfig } = await import('@/lib/eudi/verifier');
      if (eudiConfig() !== null) {
        const ver = input.eudiRequestId
          ? await client.query(
              `SELECT 1 FROM identity.eudi_verifications
                WHERE request_id = $1 AND event_id = $2 AND status = 'verified'
                  AND verified_at > NOW() - INTERVAL '2 hours'`,
              [input.eudiRequestId, input.eventId],
            )
          : { rows: [] as unknown[] };
        if (ver.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            {
              error: 'EUDI_REQUIRED',
              message: 'Tato akce vyžaduje ověření evropskou peněženkou. Dokonči ověření a zkus to znovu.',
            },
            { status: 422 },
          );
        }
      }
    }

    // Presale access code (mig 432) — per ticket_type presale window s přístupovým kódem.
    // Pouze pokud event NENÍ ve Verified Fan módu (VF má prioritu, používá stejný presaleCode field).
    if (!tt.verified_fan_enabled && tt.presale_code_required && tt.presale_code) {
      const now = Date.now();
      const startsAt = tt.presale_starts_at ? new Date(tt.presale_starts_at).getTime() : null;
      const endsAt = tt.presale_ends_at ? new Date(tt.presale_ends_at).getTime() : null;

      const inPresaleWindow =
        startsAt !== null && endsAt !== null && now >= startsAt && now <= endsAt;
      const beforePresale = startsAt !== null && now < startsAt;

      if (inPresaleWindow) {
        // Jsme v presale okně — vyžadujeme kód
        if (!input.presaleCode || input.presaleCode.toUpperCase().trim() !== tt.presale_code.toUpperCase()) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            {
              error: 'INVALID_PRESALE_CODE',
              message: 'Neplatný přístupový kód pro presale. Zkontroluj kód a zkus to znovu.',
            },
            { status: 422 },
          );
        }
      } else if (beforePresale) {
        // Před presale oknem — vstupenka zatím není v prodeji
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'NOT_YET_ON_SALE',
            message: 'Tento typ vstupenky zatím není v prodeji. Presale začíná ' +
              (tt.presale_starts_at ? new Date(tt.presale_starts_at).toLocaleDateString('cs-CZ') : 'brzy') + '.',
          },
          { status: 422 },
        );
      }
      // afterPresaleWindow: dostupné normálně, pokračujeme bez kontroly kódu
    }

    // OTP validation (CZ priority #3) — pokud event vyžaduje, validuj otpToken
    if (tt.requires_otp_validation) {
      if (!input.otpToken) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'OTP_REQUIRED', message: 'Tato akce vyžaduje ověření telefonu SMS kódem.' },
          { status: 422 },
        );
      }
      const otpCheck = await client.query<{ verified_at: string | null; expires_at: string }>(
        `SELECT verified_at::text, expires_at::text
           FROM marketing.otp_codes
          WHERE token = $1
            AND (event_id IS NULL OR event_id = $2)`,
        [input.otpToken, input.eventId],
      );
      if (otpCheck.rows.length === 0 || !otpCheck.rows[0].verified_at) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'OTP_INVALID' }, { status: 422 });
      }
      const verifiedAt = new Date(otpCheck.rows[0].verified_at).getTime();
      // Token OK valid pro 30 min od verifikace
      if (Date.now() - verifiedAt > 30 * 60 * 1000) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'OTP_EXPIRED' }, { status: 422 });
      }
    }

    // P0 RISK MITIGATION: hard cap pro T1 promotery
    // Pokud promotér ještě nepass pre-review, kontrolujeme volume_used + nový order < cap
    const capRes = await client.query<{ cap: number | null; used: number; passed_at: string | null; country: string | null }>(
      `SELECT pre_review_volume_cap_halire AS cap,
              pre_review_volume_used_halire AS used,
              pre_review_passed_at::text AS passed_at,
              country
         FROM platform.promoters
        WHERE id = $1`,
      // POZN. (concurrency): bez FOR UPDATE — tohle je jen orientační READ capu.
      // Dřív zamykal řádek promotéra na celou transakci → VŠECHNY checkouty jednoho
      // promotéra se serializovaly. Increment volume_used se děje až při platbě.
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

    // Persist promoter country for reverse charge check later
    const promoterCountry = capRes.rows[0]?.country ?? 'CZ';

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
        x: number | null;
        y: number | null;
      }>(
        `SELECT id, status, ticket_type_id, hold_until, x, y FROM catalog.event_seats
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
      const sdRes = await client.query<{ social_distance_seats: number }>(
        `SELECT social_distance_seats FROM catalog.events WHERE id = $1`,
        [input.eventId],
      );
      const distN = sdRes.rows[0]?.social_distance_seats ?? 0;
      if (distN > 0) {
        const mySeats = heldSeats.rows.map((s) => ({ id: s.id, x: s.x ?? 0, y: s.y ?? 0 }));
        const conflictRes = await client.query<{ id: string; x: number; y: number }>(
          `SELECT id, x, y FROM catalog.event_seats
            WHERE event_id = $1
              AND id != ALL($2::uuid[])
              AND status IN ('sold', 'held')
              AND (hold_until IS NULL OR hold_until > NOW())`,
          [input.eventId, input.seatIds],
        );
        for (const mine of mySeats) {
          for (const other of conflictRes.rows) {
            const dx = Math.abs((mine.x ?? 0) - (other.x ?? 0));
            const dy = Math.abs((mine.y ?? 0) - (other.y ?? 0));
            if (dy < 0.5 && dx > 0 && dx <= distN) {
              await client.query('ROLLBACK');
              return NextResponse.json(
                {
                  error: 'SOCIAL_DISTANCE_VIOLATION',
                  message: `Tato sedadla porušují pravidlo sociálního odstupu (min. ${distN} volná místa vedle).`,
                },
                { status: 409 },
              );
            }
          }
        }
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
    const userRes = await client.query<{ id: string; phone_verified_at: string | null }>(
      `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
       VALUES ($1, $2, '!guest', NOW(), NOW(), NOW())
       ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE
         SET updated_at = NOW()
       RETURNING id, phone_verified_at`,
      [input.buyerEmail.toLowerCase(), input.buyerName],
    );
    const userId = userRes.rows[0].id;

    // Per-event purchase limit (mig 433) — max_tickets_per_buyer na events omezuje
    // celkový počet vstupenek napříč všemi ticket_types pro danou akci.
    if (tt.max_tickets_per_buyer !== null && tt.max_tickets_per_buyer > 0) {
      const eventBoughtRes = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(oi.quantity), 0)::text AS total
         FROM orders.order_items oi
         JOIN orders.orders o ON o.id = oi.order_id
         WHERE o.event_id = $1
           AND o.status IN ('pending', 'paid')
           AND (o.user_id = $2 OR LOWER(o.buyer_email) = LOWER($3))`,
        [input.eventId, userId, input.buyerEmail],
      );
      const eventAlreadyBought = parseInt(eventBoughtRes.rows[0]?.total ?? '0', 10);
      if (eventAlreadyBought + input.quantity > tt.max_tickets_per_buyer) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'PURCHASE_LIMIT_EXCEEDED',
            message: `Limit pro tuto akci je ${tt.max_tickets_per_buyer} vstupenek na osobu. Již máš ${eventAlreadyBought} ks, požaduješ ${input.quantity} ks.`,
            limit: tt.max_tickets_per_buyer,
            alreadyBought: eventAlreadyBought,
          },
          { status: 422 },
        );
      }
    }

    // Per-ticket-type purchase limit (mig 433) — max_per_buyer na ticket_type.
    if (tt.max_per_buyer !== null && tt.max_per_buyer > 0) {
      const ttBoughtRes = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(oi.quantity), 0)::text AS total
         FROM orders.order_items oi
         JOIN orders.orders o ON o.id = oi.order_id
         WHERE oi.ticket_type_id = $1
           AND o.status IN ('pending', 'paid')
           AND (o.user_id = $2 OR LOWER(o.buyer_email) = LOWER($3))`,
        [tt.id, userId, input.buyerEmail],
      );
      const ttAlreadyBought = parseInt(ttBoughtRes.rows[0]?.total ?? '0', 10);
      if (ttAlreadyBought + input.quantity > tt.max_per_buyer) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'PURCHASE_LIMIT_EXCEEDED',
            message: `Limit pro tento typ vstupenky je ${tt.max_per_buyer} ks na osobu. Již máš ${ttAlreadyBought} ks, požaduješ ${input.quantity} ks.`,
            limit: tt.max_per_buyer,
            alreadyBought: ttAlreadyBought,
          },
          { status: 422 },
        );
      }
    }

    // Per-buyer purchase limit — max_per_user na ticket_type omezuje počet kusů
    // které může jeden uživatel (resp. email) koupit celkem přes všechny objednávky.
    if (tt.max_per_user !== null && tt.max_per_user > 0) {
      const boughtRes = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(oi.quantity), 0)::text AS total
         FROM orders.order_items oi
         JOIN orders.orders o ON o.id = oi.order_id
         WHERE oi.ticket_type_id = $1
           AND o.user_id = $2
           AND o.status IN ('pending', 'paid')`,
        [tt.id, userId],
      );
      const alreadyBought = parseInt(boughtRes.rows[0]?.total ?? '0', 10);
      if (alreadyBought + input.quantity > tt.max_per_user) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'PURCHASE_LIMIT_EXCEEDED',
            message: `Limit je ${tt.max_per_user} ks na osobu. Již máš ${alreadyBought} ks, požaduješ ${input.quantity} ks.`,
            limit: tt.max_per_user,
            alreadyBought,
          },
          { status: 422 },
        );
      }
    }

    // Phone verification gate — proaktivní autentizace: event vyžaduje ověřený telefon.
    if (tt.require_phone_verified && !userRes.rows[0].phone_verified_at) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: 'PHONE_VERIFICATION_REQUIRED',
          message: 'Tato akce vyžaduje ověřené telefonní číslo. Ověřte telefon v nastavení účtu.',
        },
        { status: 422 },
      );
    }

    // 3) Inventář se rezervuje AŽ TĚSNĚ PŘED COMMITEM (atomicky, podmíněně) —
    //    viz blok "ATOMICKÁ REZERVACE INVENTÁŘE" níže. Tím se drží řádkový zámek
    //    na ticket_type jen po dobu pár inserts, ne přes fraud scoring + slevy.
    //    Měkká kontrola remaining_qty proběhla výš (fail-fast); finální správnost
    //    zajistí podmíněný UPDATE (WHERE remaining_qty >= qty).

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
      const volRes = await client.query<{ discount_pct: number; min_qty: number; free_qty: number }>(
        `SELECT discount_pct, min_qty, free_qty
         FROM catalog.volume_discount_rules
         WHERE ticket_type_id = $1 AND active = TRUE AND min_qty <= $2
         ORDER BY min_qty DESC
         LIMIT 1`,
        [tt.id, input.quantity],
      );
      if (volRes.rows.length > 0) {
        const vr = volRes.rows[0];
        if (vr.free_qty > 0) {
          // BOGO: free_qty tickets are free (deduct their unit price)
          const freeCount = Math.min(vr.free_qty, input.quantity - vr.min_qty + vr.free_qty);
          volumeDiscountAmount = Math.min(unitPriceHalire * freeCount, subtotalAmount);
          volumeDiscountPct = Math.round((volumeDiscountAmount / (unitPriceHalire * input.quantity)) * 100);
        } else {
          volumeDiscountPct = vr.discount_pct;
          volumeDiscountAmount = Math.floor((subtotalAmount * volumeDiscountPct) / 100);
        }
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
      // Validitu (valid_from/valid_until) vyhodnocuje DB svým vlastním now() —
      // NIKDY neporovnávat DB-timestamp proti JS `new Date()`: DB (Neon) a app
      // (Vercel) jsou jiné stroje s nezávislými hodinami, takže čerstvě vytvořený
      // kód by byl chybně odmítnut jako NOT_YET_VALID kvůli clock skew.
      const pcRes = await client.query<{
        id: string;
        type: string;
        discount_value: number;
        max_uses: number | null;
        uses_count: number;
        not_yet_valid: boolean;
        expired: boolean;
      }>(
        `SELECT id, type, discount_value, max_uses, uses_count,
                (valid_from > now())                                  AS not_yet_valid,
                (valid_until IS NOT NULL AND valid_until < now())     AS expired
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
      if (pc.not_yet_valid) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'PROMO_CODE_NOT_YET_VALID' },
          { status: 422 },
        );
      }
      if (pc.expired) {
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

    // 3f) B2B credit pre-check — pokud paymentMethod='b2b_credit', ověříme balance
    // a rezervujeme PŘED insertem objednávky. Pokud balance nestačí → 402.
    // Finální debit + transakce proběhnou těsně před COMMIT (po order INSERT,
    // aby order_id bylo k dispozici pro b2b_transaction.order_id).
    let b2bAccountId: string | null = null;
    if (input.paymentMethod === 'b2b_credit') {
      if (!input.b2bAccountCode) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'B2B_ACCOUNT_CODE_REQUIRED' },
          { status: 422 },
        );
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

    // EVENTIM.Travel — validate package + compute price (added to totalAmount before voucher/loyalty)
    let travelBookingData: {
      packageId: string;
      hotelName: string;
      hotelAddress: string | null;
      hotelStars: number | null;
      roomName: string;
      checkinDate: string;
      checkoutDate: string;
      nights: number;
      guests: number;
      pricePerNightHalire: number;
      totalPriceHalire: number;
    } | null = null;

    if (input.travelPackageId) {
      const tp = await client.query<{
        id: string;
        hotel_name: string;
        hotel_address: string | null;
        hotel_stars: number | null;
        room_name: string;
        checkin_date: string;
        checkout_date: string;
        nights: number;
        total_capacity: number;
        reserved_count: number;
        price_per_night_halire: number;
      }>(
        `SELECT p.id, h.name AS hotel_name, h.address AS hotel_address, h.stars AS hotel_stars,
                r.name AS room_name, p.checkin_date, p.checkout_date, p.nights,
                p.total_capacity, p.reserved_count,
                COALESCE(p.price_per_night_override_halire, r.price_per_night_halire) AS price_per_night_halire
           FROM catalog.event_travel_packages p
           JOIN catalog.travel_hotels h ON h.id = p.hotel_id
           JOIN catalog.travel_hotel_rooms r ON r.id = p.hotel_room_id
          WHERE p.id = $1 AND p.event_id = $2 AND p.active = true AND h.active = true AND r.active = true
          FOR UPDATE OF p`,
        [input.travelPackageId, input.eventId],
      );
      if (tp.rowCount === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TRAVEL_PACKAGE_NOT_FOUND' }, { status: 404 });
      }
      const pkg = tp.rows[0];
      if (pkg.total_capacity > 0 && pkg.reserved_count >= pkg.total_capacity) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'TRAVEL_PACKAGE_FULL', message: 'Ubytování je plně obsazeno.' },
          { status: 409 },
        );
      }
      const guests = input.travelGuests ?? 1;
      const travelTotal = pkg.price_per_night_halire * pkg.nights * guests;
      totalAmount += travelTotal;
      travelBookingData = {
        packageId: pkg.id,
        hotelName: pkg.hotel_name,
        hotelAddress: pkg.hotel_address,
        hotelStars: pkg.hotel_stars,
        roomName: pkg.room_name,
        checkinDate: pkg.checkin_date,
        checkoutDate: pkg.checkout_date,
        nights: pkg.nights,
        guests,
        pricePerNightHalire: pkg.price_per_night_halire,
        totalPriceHalire: travelTotal,
      };
    }

    // Parking bundle (mig 402) — atomická rezervace parkovacího místa.
    let parkingFeeHalire = 0;
    let parkingBookingData: { offerId: string; confirmationCode: string; name: string } | null = null;
    if (input.parkingOfferId) {
      const po = await client.query<{
        id: string; name: string; price_halire: number;
        capacity: number; reserved_count: number;
      }>(
        `SELECT id, name, price_halire, capacity, reserved_count
           FROM catalog.parking_offers
          WHERE id = $1 AND event_id = $2 AND active = true
            AND (booking_deadline IS NULL OR booking_deadline > NOW())
          FOR UPDATE`,
        [input.parkingOfferId, input.eventId],
      );
      if (po.rowCount === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'PARKING_OFFER_NOT_FOUND' }, { status: 404 });
      }
      const offer = po.rows[0];
      if (offer.capacity > 0 && offer.reserved_count >= offer.capacity) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'PARKING_FULL', message: 'Parkovací místo je plně obsazeno.' },
          { status: 409 },
        );
      }
      parkingFeeHalire = offer.price_halire;
      totalAmount += parkingFeeHalire;
      parkingBookingData = {
        offerId: offer.id,
        name: offer.name,
        confirmationCode: `PKG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      };
    }

    // Postal delivery fee (mig 418) — přičte poštovné pokud buyer zvolil fyzické doručení.
    let postalFeeHalire = 0;
    if (input.deliveryMethod === 'postal') {
      const country = (input.postalCountry ?? 'CZ').toUpperCase();
      const feeRow = await client.query<{ fee_halire: number; carrier: string }>(
        `SELECT fee_halire, carrier FROM platform.postal_fees WHERE country=$1 AND active=true`,
        [country],
      );
      if (feeRow.rowCount === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'POSTAL_NOT_AVAILABLE_FOR_COUNTRY' }, { status: 422 });
      }
      postalFeeHalire = feeRow.rows[0].fee_halire;
      totalAmount += postalFeeHalire;
    }

    // Carbon offset (mig 421) — dobrovolný příplatek za CO₂ kompenzaci.
    let carbonOffsetHalire = 0;
    if (input.carbonOffsetOptIn === true) {
      const co2Row = await client.query<{ amount_halire: number }>(
        `SELECT amount_halire FROM platform.carbon_offset_settings WHERE active=true ORDER BY id LIMIT 1`,
      );
      if (co2Row.rowCount && co2Row.rowCount > 0) {
        carbonOffsetHalire = co2Row.rows[0].amount_halire;
        totalAmount += carbonOffsetHalire;
      }
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

    // Gift karta redemption (mig 431) — aplikuje se po voucheru, před restwert.
    // Odečte min(remaining, totalAmount) od totalAmount; debit po COMMIT.
    let giftCardRedeemedHalire = 0;
    let giftCardId: string | null = null;
    if (input.giftCardCode && totalAmount > 0) {
      const gcCode = input.giftCardCode.trim().toUpperCase();
      const gcRes = await client.query<{
        id: string;
        remaining_value_halire: string;
        is_active: boolean;
        expires_at: string | null;
      }>(
        `SELECT id, remaining_value_halire, is_active, expires_at
           FROM platform.gift_cards
          WHERE code = $1
          FOR UPDATE`,
        [gcCode],
      );
      if (gcRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'GIFT_CARD_INVALID', message: 'Gift karta nebyla nalezena.' }, { status: 422 });
      }
      const gc = gcRes.rows[0];
      if (!gc.is_active) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'GIFT_CARD_INACTIVE', message: 'Tato gift karta není aktivní.' }, { status: 422 });
      }
      if (gc.expires_at && new Date(gc.expires_at).getTime() < Date.now()) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'GIFT_CARD_EXPIRED', message: 'Platnost gift karty vypršela.' }, { status: 422 });
      }
      const remaining = parseInt(gc.remaining_value_halire, 10);
      if (remaining === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'GIFT_CARD_DEPLETED', message: 'Gift karta je vyčerpána.' }, { status: 422 });
      }
      giftCardRedeemedHalire = Math.min(remaining, totalAmount);
      giftCardId = gc.id;
      totalAmount -= giftCardRedeemedHalire;
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

    // Loyalty points pre-calculation (CZ priority #6) — kalkulace discount
    // PŘED orderId creation; engine.redeemPoints volán v post-orderId block.
    let loyaltyDiscountHalire = 0;
    let loyaltyRedeemed = 0;
    let loyaltyMaxPointsAvailable = 0;
    if (
      input.redeemLoyaltyPoints &&
      input.redeemLoyaltyPoints > 0 &&
      totalAmount > 0
    ) {
      const { calculateMaxRedemption } = await import('@/lib/loyalty/engine');
      const acc = await client.query<{ points_balance: number }>(
        `SELECT points_balance FROM marketing.loyalty_accounts WHERE user_id = $1`,
        [userId],
      );
      if (acc.rows.length > 0) {
        const limits = calculateMaxRedemption({
          pointsBalance: acc.rows[0].points_balance,
          orderSubtotalHalire: subtotalAmount,
        });
        loyaltyMaxPointsAvailable = limits.maxPoints;
        loyaltyRedeemed = Math.min(input.redeemLoyaltyPoints, limits.maxPoints);
        loyaltyDiscountHalire = loyaltyRedeemed * 100; // 1 bod = 1 Kč = 100 halire
        totalAmount = Math.max(0, totalAmount - loyaltyDiscountHalire);
      }
    }

    // Service fee pro koncového zákazníka (buyer) — fixní částka dle nastavení
    // promotéra (per vstupenku / per objednávku). Přičítá se NAVRCH, po všech
    // slevách (poplatek se neslevňuje). Ukládá se zvlášť (service_fee_minor),
    // aby ho payout vyloučil z promotérova gross (je to platform revenue).
    const { resolveServiceFee } = await import('@/lib/fees/service-fee');
    const svcFee = await resolveServiceFee(client, {
      promoterId: tt.promoter_id,
      currency: tt.currency,
      quantity: input.quantity,
    });
    const serviceFeeMinor = svcFee.totalFeeMinor;
    totalAmount += serviceFeeMinor;

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

    // EU B2B Reverse charge check (mig 390)
    let isReverseCharge = false;
    let resolvedBuyerVatNumber: string | null = null;
    let resolvedBuyerCompanyName: string | null = input.buyerCompanyName ?? null;
    if (input.buyerVatNumber) {
      const viesResult = await validateVatNumber(input.buyerVatNumber);
      if (viesResult.isValid) {
        resolvedBuyerVatNumber = input.buyerVatNumber.toUpperCase().replace(/\s/g, '');
        isReverseCharge = isReverseChargeApplicable(viesResult.countryCode, promoterCountry);
        if (!resolvedBuyerCompanyName && viesResult.name) {
          resolvedBuyerCompanyName = viesResult.name;
        }
      }
    }

    const orderRes = await client.query<{ id: string }>(
      `INSERT INTO orders.orders
         (user_id, event_id, status, total_amount, currency, locale,
          gopay_payment_id, payment_provider, idempotency_key,
          discount_halire, promo_code_id, requires_age_verification,
          is_gift, gift_recipient_email, gift_recipient_name, gift_message, gift_redeem_token,
          holder_names, variable_symbol, entry_slot_id, service_fee_minor,
          buyer_vat_number, buyer_company_name, is_reverse_charge,
          withdrawal_rights_shown,
          delivery_method, postal_fee_halire,
          carbon_offset_halire,
          expires_at, created_at, updated_at)
       VALUES ($1, $2, 'pending', $3, $4, 'cs',
               $5, $6, $7,
               $8, $9, $10,
               $11, $12, $13, $14, $15,
               $16, $17, $19, $20,
               $21, $22, $23,
               $24,
               $25, $26,
               $27,
               NOW() + ($18 || '')::interval, NOW(), NOW())
       RETURNING id`,
      [
        userId,
        input.eventId,
        totalAmount,
        tt.currency,
        paymentId,
        input.paymentMethod,
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
        serviceFeeMinor,
        resolvedBuyerVatNumber,
        resolvedBuyerCompanyName,
        isReverseCharge,
        true, // withdrawal_rights_shown — CRD Art. 16(l) exemption shown at checkout
        input.deliveryMethod ?? 'digital',
        postalFeeHalire,
        carbonOffsetHalire,
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

    // Verified Fan — označ presale_code jako použitý (one-time use, prevents
    // share na social media). Pokud user platbu nedotáhne, expires_at na
    // orderu uvolní hold, ale code je permanentně burnt — to je záměrné
    // anti-abuse opatření (re-issue přes admin endpoint pokud user napíše).
    if (verifiedFanRequestId) {
      await client.query(
        `UPDATE marketing.verified_fan_requests
            SET status = 'used', used_order_id = $2, used_at = NOW()
          WHERE id = $1`,
        [verifiedFanRequestId, orderId],
      );
    }

    // Group invitation linkage (CZ priority #5) — friend přišel přes share URL.
    // Najdi open invitation s matching event_id a link order.
    if (input.groupInvitationToken) {
      const gi = await client.query<{ id: string; target_seats: number }>(
        `SELECT id, target_seats FROM orders.group_invitations
          WHERE invite_token = $1
            AND event_id = $2
            AND status = 'open'
            AND expires_at > NOW()`,
        [input.groupInvitationToken, input.eventId],
      );
      if (gi.rows.length > 0) {
        await client.query(
          `UPDATE orders.orders SET group_invitation_id = $2 WHERE id = $1`,
          [orderId, gi.rows[0].id],
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
      const lr = await client.query<{
        source: string;
        status: string;
        deadline: string | null;
      }>(
        `SELECT 'campaigns' AS source, le.status, le.payment_deadline AS deadline
         FROM orders.lottery_entries le
         JOIN orders.lottery_campaigns lc ON lc.id = le.campaign_id
         WHERE le.id = $1
           AND (lc.ticket_type_id = $2 OR lc.ticket_type_id IS NULL)
         FOR UPDATE OF le
         UNION ALL
         SELECT 'catalog' AS source, le2.status, le2.redeem_deadline AS deadline
         FROM catalog.lottery_entries le2
         WHERE le2.id = $1 AND le2.ticket_type_id = $2
         FOR UPDATE OF le2
         LIMIT 1`,
        [input.lotteryEntryId, tt.id],
      );
      if (lr.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'LOTTERY_ENTRY_INVALID' },
          { status: 422 },
        );
      }
      const lrRow = lr.rows[0];
      const isWon = lrRow.status === 'won' || lrRow.status === 'winner';
      if (!isWon) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'LOTTERY_NOT_WINNER', status: lrRow.status },
          { status: 409 },
        );
      }
      if (lrRow.deadline && new Date(lrRow.deadline).getTime() < Date.now()) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'LOTTERY_DEADLINE_PASSED' }, { status: 409 });
      }
      if (lrRow.source === 'campaigns') {
        await client.query(
          `UPDATE orders.lottery_entries
           SET status = 'converted', order_id = $2, updated_at = NOW()
           WHERE id = $1`,
          [input.lotteryEntryId, orderId],
        );
      } else {
        await client.query(
          `UPDATE catalog.lottery_entries
           SET status = 'redeemed', redeemed_at = NOW(), redeemed_order_id = $2
           WHERE id = $1`,
          [input.lotteryEntryId, orderId],
        );
      }
    }

    {
      const activeCampaign = await client.query<{ id: string }>(
        `SELECT lc.id FROM orders.lottery_campaigns lc
         WHERE lc.event_id = $1
           AND (lc.ticket_type_id = $2 OR lc.ticket_type_id IS NULL)
           AND lc.status IN ('open', 'drawn')
         LIMIT 1`,
        [input.eventId, input.ticketTypeId],
      );
      if (activeCampaign.rows.length > 0 && !input.lotteryEntryId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'LOTTERY_ENTRY_REQUIRED',
            message: 'Tato vstupenka je přidělována losováním. Pro nákup potřebujete platný výherní token.',
          },
          { status: 403 },
        );
      }
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

    // ── ATOMICKÁ REZERVACE INVENTÁŘE (těsně před commitem) ──────────────────
    // Podmíněný UPDATE: sníží remaining_qty JEN pokud je dost. Drží řádkový zámek
    // na ticket_type jen do COMMITu (pár inserts), ne přes celou transakci →
    // checkouty jednoho typu se serializují jen na tomhle krátkém okně.
    // Pokud mezi měkkou kontrolou výš a tímhle někdo vykoupil zbytek → 409 (žádný oversell).
    const reserve = await client.query(
      `UPDATE catalog.ticket_types
          SET remaining_qty = remaining_qty - $1
        WHERE id = $2 AND remaining_qty >= $1
        RETURNING remaining_qty`,
      [input.quantity, tt.id],
    );
    if (reserve.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Insufficient inventory', message: 'Vstupenky se mezitím vyprodaly.' },
        { status: 409 },
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

    // EVENTIM.Travel — zápis rezervace + atomický inkrement reserved_count
    if (travelBookingData) {
      const confCode = `TXL-HTL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      await client.query(
        `INSERT INTO orders.travel_bookings
           (order_id, package_id, hotel_name, hotel_address, hotel_stars, room_name,
            checkin_date, checkout_date, nights, guests, price_per_night_halire, total_price_halire,
            confirmation_code, guest_notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending')`,
        [
          orderId,
          travelBookingData.packageId,
          travelBookingData.hotelName,
          travelBookingData.hotelAddress,
          travelBookingData.hotelStars,
          travelBookingData.roomName,
          travelBookingData.checkinDate,
          travelBookingData.checkoutDate,
          travelBookingData.nights,
          travelBookingData.guests,
          travelBookingData.pricePerNightHalire,
          travelBookingData.totalPriceHalire,
          confCode,
          input.travelNotes ?? null,
        ],
      );
      await client.query(
        `UPDATE catalog.event_travel_packages
            SET reserved_count = reserved_count + 1
          WHERE id = $1`,
        [travelBookingData.packageId],
      );
    }

    // Parking bundle — zápis rezervace do orders.bundle_items + atomický reserved_count
    if (parkingBookingData) {
      await client.query(
        `INSERT INTO orders.bundle_items
           (order_id, item_type, parking_offer_id, price_halire, confirmation_code, status)
         VALUES ($1, 'parking', $2, $3, $4, 'confirmed')`,
        [orderId, parkingBookingData.offerId, parkingFeeHalire, parkingBookingData.confirmationCode],
      );
      await client.query(
        `UPDATE catalog.parking_offers SET reserved_count = reserved_count + 1 WHERE id = $1`,
        [parkingBookingData.offerId],
      );
    }

    // Postal delivery — zápis adresy do orders.postal_deliveries (status=pending)
    if (input.deliveryMethod === 'postal' && input.postalAddressLine1 && input.postalCity) {
      await client.query(
        `INSERT INTO orders.postal_deliveries
           (order_id, recipient_name, address_line1, city, postal_code, country)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          orderId,
          input.postalName ?? '',
          input.postalAddressLine1,
          input.postalCity,
          input.postalPostalCode ?? '',
          (input.postalCountry ?? 'CZ').toUpperCase(),
        ],
      );
    }

    // Gift karta: dekrement remaining_value (uvnitř transakce, těsně před COMMIT)
    if (giftCardId && giftCardRedeemedHalire > 0) {
      await client.query(
        `UPDATE platform.gift_cards
         SET remaining_value_halire = remaining_value_halire - $2,
             is_active = CASE WHEN remaining_value_halire - $2 = 0 THEN false ELSE is_active END,
             last_used_at = NOW()
         WHERE id = $1`,
        [giftCardId, giftCardRedeemedHalire],
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

    // Loyalty points apply (CZ priority #6) — INSERT transaction + UPDATE
    // balance. Engine vyhodí pokud account nebyl pre-validated, ale my
    // jsme pre-calc už ověřili.
    if (loyaltyRedeemed > 0) {
      const { redeemPoints } = await import('@/lib/loyalty/engine');
      await redeemPoints(client, {
        userId,
        orderId,
        pointsToRedeem: loyaltyRedeemed,
        orderSubtotalHalire: subtotalAmount,
      });
    }

    // B2B credit debit (uvnitř transakce, těsně před COMMIT)
    if (input.paymentMethod === 'b2b_credit' && input.b2bAccountCode) {
      const b2bRes = await client.query<{
        id: string;
        credit_balance_halire: string;
      }>(
        `SELECT id, credit_balance_halire
         FROM platform.b2b_accounts
         WHERE account_code = upper($1) AND status = 'active'
         FOR UPDATE`,
        [input.b2bAccountCode],
      );
      if (b2bRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'B2B_ACCOUNT_INVALID' }, { status: 402 });
      }
      const b2bBalance = parseInt(b2bRes.rows[0].credit_balance_halire, 10);
      if (b2bBalance < totalAmount) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'INSUFFICIENT_B2B_CREDIT', balanceHalire: b2bBalance, requiredHalire: totalAmount },
          { status: 402 },
        );
      }
      b2bAccountId = b2bRes.rows[0].id;
      await client.query(
        `UPDATE platform.b2b_accounts
         SET credit_balance_halire = credit_balance_halire - $2
         WHERE id = $1`,
        [b2bAccountId, totalAmount],
      );
      const newBalRes = await client.query<{ credit_balance_halire: string }>(
        `SELECT credit_balance_halire FROM platform.b2b_accounts WHERE id = $1`,
        [b2bAccountId],
      );
      const newBalance = parseInt(newBalRes.rows[0].credit_balance_halire, 10);
      await client.query(
        `INSERT INTO platform.b2b_transactions
           (account_id, order_id, type, amount_halire, balance_after)
         VALUES ($1, $2, 'purchase', $3, $4)`,
        [b2bAccountId, orderId, -totalAmount, newBalance],
      );
      // Označit objednávku jako ihned zaplacenu (žádná gateway)
      await client.query(
        `UPDATE orders.orders
         SET status = 'paid', payment_provider = 'b2b_credit', updated_at = NOW()
         WHERE id = $1`,
        [orderId],
      );
    }

    // Gift claim INSERT (uvnitř transakce, před COMMIT)
    let giftClaimToken: string | undefined;
    if (input.giftRecipientEmail) {
      const productionRes = await client.query<{ production_id: string | null }>(
        `SELECT production_id FROM catalog.events WHERE id = $1`,
        [input.eventId],
      );
      const productionId = productionRes.rows[0]?.production_id ?? null;

      const gcRes = await client.query<{ claim_token: string }>(
        `INSERT INTO orders.gift_claims
           (order_id, recipient_email, recipient_name, gift_message,
            event_id, ticket_type_id, production_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING claim_token`,
        [
          orderId,
          input.giftRecipientEmail.toLowerCase(),
          input.giftRecipientName ?? null,
          input.giftMessage ?? null,
          input.eventId,
          input.ticketTypeId,
          productionId,
        ],
      );
      giftClaimToken = gcRes.rows[0].claim_token;
    }

    await client.query('COMMIT');

    // Splátkový plán (mig 094/232) — attach plan after COMMIT, reduce charge to deposit only.
    let depositAmount: number | null = null;
    if (input.paymentPlanId) {
      try {
        const planRow = await db().query<{
          id: string; deposit_pct: number; installments_count: number;
          interval_days: number; event_id: string | null; active: boolean;
        }>(
          `SELECT id, deposit_pct, installments_count, interval_days, event_id, active
             FROM catalog.payment_plans WHERE id = $1`,
          [input.paymentPlanId],
        );
        const plan = planRow.rows[0];
        if (plan && plan.active && (plan.event_id === null || plan.event_id === input.eventId)) {
          depositAmount = Math.floor((totalAmount * plan.deposit_pct) / 100);
          const remaining = totalAmount - depositAmount;
          const oppRes = await db().query<{ id: string }>(
            `INSERT INTO orders.order_payment_plans
               (order_id, plan_id, total_amount, currency, deposit_amount, status)
             VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
            [orderId, plan.id, totalAmount, tt.currency, depositAmount],
          );
          const oppId = oppRes.rows[0].id;
          if (plan.installments_count > 0) {
            const base = Math.floor(remaining / plan.installments_count);
            const last = remaining - base * (plan.installments_count - 1);
            const now = Date.now();
            for (let i = 1; i <= plan.installments_count; i++) {
              const amt = i === plan.installments_count ? last : base;
              const dueAt = new Date(now + plan.interval_days * i * 24 * 60 * 60 * 1000);
              await db().query(
                `INSERT INTO orders.payment_installments
                   (order_payment_plan_id, sequence, amount, due_at, status)
                 VALUES ($1, $2, $3, $4, 'pending')`,
                [oppId, i, amt, dueAt.toISOString()],
              );
            }
          }
        }
      } catch (planErr) {
        console.error('[checkout] payment plan attach error:', planErr);
        // Non-fatal — fall back to full payment
        depositAmount = null;
      }
    }

    // Po commitu: foyer pre-order (mig 359) — DOČASNĚ VYPNUTO (schema drift, třída 3 ORPHAN).
    // Realita schématu: orders.foyer_orders má DENORMALIZOVANÝ tvar (`items` jsonb NOT NULL,
    // BEZ user_id/buyer_email), a orders.foyer_order_items NEEXISTUJE. Původní INSERT
    // (user_id/buyer_email + child řádky) padal 42703/42P01 AŽ PO COMMITu objednávky (:2128),
    // takže objednávka držela inventář a buyer dostal 500 → orphan pending.
    // Blok odstraněn: input.foyerItems je ZÁMĚRNĚ ignorován (žádný orphan, žádný false-success —
    // foyerOrderToken zůstává undefined → odpověď NETVRDÍ foyer úspěch). Foyer fieldset je zároveň
    // skryt v UI (checkout/page.tsx: FOYER_PREORDER_ENABLED=false), takže buyer ho ani nevybere.
    // Znovuzapnutí = feature ticket "foyer pre-order → přepsat na jsonb model E2E" (REMEDIATION.md).
    const foyerOrderToken: string | undefined = undefined;
    void input.foyerItems; // schema-accepted, ale záměrně nepersistováno (viz výše)

    // Digitální program (mig 359) — INSERT program_purchase + vrátit access_token.
    // ⚠️ NEDOSAŽITELNÉ: input.addProgram je fail-closed odmítnut early-guardem výše
    // (před BEGIN), takže sem s addProgram=true nikdy nedojde. Blok PONECHÁN ZÁMĚRNĚ jako
    // baseline dluh (SELECT event_programs = drift třídy 3, event_programs je rozvrhová tabulka,
    // program_price_halire/is_published neexistují). NEOPRAVOVAT column-fixem ani migrací tvořící
    // booklet sloupce = to je featura (viz feature ticket v REMEDIATION.md).
    let programAccessToken: string | undefined;
    if (input.addProgram) {
      const progRow = await db().query<{ id: string; program_price_halire: number }>(
        `SELECT id, program_price_halire
         FROM catalog.event_programs
         WHERE event_id = $1 AND is_published = true AND program_price_halire > 0
         LIMIT 1`,
        [input.eventId],
      );
      if (progRow.rows.length > 0) {
        const prog = progRow.rows[0];
        const ppRow = await db().query<{ access_token: string }>(
          `INSERT INTO orders.program_purchases (order_id, program_id, price_halire)
           VALUES ($1, $2, $3)
           RETURNING access_token`,
          [orderId, prog.id, prog.program_price_halire],
        );
        programAccessToken = ppRow.rows[0].access_token;
      }
    }

    // B2B credit — žádná platební brána. Objednávka je ihned 'paid', přesměruj na potvrzení.
    if (input.paymentMethod === 'b2b_credit') {
      return NextResponse.json({
        orderId,
        paymentId: null,
        gatewayUrl: `${process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/cs/order/${orderId}/confirmation`,
        provider: 'b2b_credit',
        variableSymbol: null,
        subtotalAmount,
        discountAmount,
        volumeDiscountAmount,
        volumeDiscountPct,
        addonsSubtotal,
        bundleDiscountAmount,
        bundleId,
        voucherRedeemedHalire,
        giftCardApplied: giftCardRedeemedHalire,
        restwertAppliedHalire,
        restwertHolders,
        loyaltyDiscountHalire,
        loyaltyRedeemed,
        loyaltyMaxPointsAvailable,
        totalAmount,
        promoCodeApplied: promoCodeId !== null,
        b2bAccountId,
        ...(foyerOrderToken ? { foyerOrderToken } : {}),
        ...(programAccessToken ? { programAccessToken } : {}),
        ...(giftClaimToken ? { giftClaimToken } : {}),
        ...(travelBookingData ? { travelHotelName: travelBookingData.hotelName, travelCheckinDate: travelBookingData.checkinDate, travelNights: travelBookingData.nights } : {}),
      });
    }

    // Saved payment method — pokud kupec poslal savedPaymentMethodId, načteme token
    // a označíme last_used_at. Reálný GoPay recurrence token se předává dále pro 1-click platbu.
    let savedPaymentToken: string | null = null;
    if (input.savedPaymentMethodId) {
      const spmRes = await db().query<{ token: string }>(
        `UPDATE identity.saved_payment_methods
         SET last_used_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING token`,
        [input.savedPaymentMethodId, userId],
      );
      if (spmRes.rows.length > 0) {
        savedPaymentToken = spmRes.rows[0].token;
      }
    }
    void savedPaymentToken; // Wire-up: token k dispozici pro budoucí GoPay recurrence volání.

    // Po commitu: vytvoř payment session přes provider switcher.
    // Benefit karty (Pluxee/Sodexo/Benefit Plus/Edenred/Gallery Beta) jdou přes vlastní lib.
    const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const benefitProviders = new Set([
      'pluxee',
      'sodexo',
      'benefit_plus',
      'edenred',
      'gallery_beta',
      'multisport',
    ]);
    let paymentSession;

    const bnplProviders = new Set(['twisto', 'skippay']);
    if (input.paymentMethod === 'crypto') {
      // Krypto (Bitcoin/stablecoiny) přes Triple-A. Nakonfigurovaný → reálná
      // hosted brána + webhook potvrzení; jinak mock (jen mimo produkci —
      // early-guard výše to na prod bez Triple-A vůbec nepustí).
      const { getTripleAConfig, createTripleAPayment } = await import('@/lib/payment/triplea');
      if (getTripleAConfig().isConfigured) {
        const session = await createTripleAPayment({
          orderId,
          amountHalire: depositAmount !== null ? depositAmount : totalAmount,
          currency: tt.currency,
          notifyUrl: `${appUrl}/api/payments/triplea/webhook`,
          successUrl: `${appUrl}/cs/order-confirmation/${orderId}`,
          cancelUrl: `${appUrl}/cs/checkout?orderId=${orderId}&canceled=1`,
        });
        paymentSession = {
          paymentId: session.paymentReference,
          gatewayUrl: session.hostedUrl,
          provider: 'crypto',
        };
      } else {
        const cryptoPaymentId = randomUUID();
        paymentSession = {
          paymentId: cryptoPaymentId,
          gatewayUrl: `${appUrl}/mock-crypto/${cryptoPaymentId}`,
          provider: 'crypto',
        };
      }
    } else if (bnplProviders.has(input.paymentMethod)) {
      // BNPL mock provider — žádný real API, dev mode similar k mock-gopay
      const bnplPaymentId = randomUUID();
      paymentSession = {
        paymentId: bnplPaymentId,
        gatewayUrl: `${appUrl}/mock-bnpl/${input.paymentMethod}/${bnplPaymentId}`,
        provider: input.paymentMethod,
      };
    } else if (benefitProviders.has(input.paymentMethod)) {
      const { createBenefitPayment, BenefitProviderUnavailableError } =
        await import('@/lib/payment/benefits');
      // Sodexo používá Pluxee infrastrukturu (Pluxee koupil Sodexo Benefits v 2023)
      const benefitProvider = (input.paymentMethod === 'sodexo' ? 'pluxee' : input.paymentMethod) as
        | 'pluxee'
        | 'benefit_plus'
        | 'edenred'
        | 'gallery_beta'
        | 'multisport';
      try {
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
      } catch (e) {
        if (e instanceof BenefitProviderUnavailableError) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            {
              error: 'PAYMENT_METHOD_UNAVAILABLE',
              message:
                'Tato benefit karta není v tomto prostředí k dispozici. Zvolte jinou metodu.',
              provider: benefitProvider,
              reason: e.reason,
            },
            { status: 503 },
          );
        }
        throw e;
      }
    } else {
      const { createPayment } = await import('@/lib/payment/provider');
      paymentSession = await createPayment({
        orderId,
        amountHalire: depositAmount !== null ? depositAmount : totalAmount,
        currency: tt.currency,
        buyerEmail: input.buyerEmail,
        description: `${tt.event_title} × ${input.quantity}`,
        paymentMethod: input.paymentMethod as 'gopay' | 'wero' | 'przelewy24' | 'bank_transfer' | 'mollie' | 'paypal',
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
      giftCardApplied: giftCardRedeemedHalire,
      restwertAppliedHalire,
      restwertHolders,
      loyaltyDiscountHalire,
      loyaltyRedeemed,
      loyaltyMaxPointsAvailable,
      totalAmount,
      promoCodeApplied: promoCodeId !== null,
      ...(foyerOrderToken ? { foyerOrderToken } : {}),
      ...(programAccessToken ? { programAccessToken } : {}),
      ...(giftClaimToken ? { giftClaimToken } : {}),
      ...(travelBookingData ? { travelHotelName: travelBookingData.hotelName, travelCheckinDate: travelBookingData.checkinDate, travelNights: travelBookingData.nights } : {}),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[checkout-demo]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
