/**
 * Sdílená dráha pro live testy: ephemeral Neon klon + seed factory.
 *
 * ── Proč ─────────────────────────────────────────────────────────────────────
 * Neon boilerplate (create branch → connection_uri → apply pending migrations →
 * delete branch) byl zkopírovaný ve VŠECH 5 live testech, seed řetězu
 * promoter→venue→event→ticket_type ve 3. Kopie se rozcházely v tom, které
 * NOT NULL sloupce dodávají, takže každý nový test znovu narazil na tentýž
 * řetěz 23502 (promoters.email, tickets.original_owner_id, totp_secret_iv,
 * original_price…). Tohle je jedno místo pravdy.
 *
 * ── Zásada: seed NESMÍ vyrábět data jiného tvaru než produkce ────────────────
 * Lístky se proto NESEEDUJÍ ručním INSERTem. Volá se `issueTicketsForOrder`
 * z `@/lib/tickets/demo-issuer` — tedy TÁŽ funkce, kterou používá checkout,
 * comps i guestlist. Ta jediná ví, jak se plní `totp_secret_encrypted`
 * (šifrovaný bundle přes `encryptSecret`), `totp_secret_iv` (záměrně prázdný
 * buffer) a `ticket_seq`. Kdyby si seed ta pole vymyslel, testy by prošly nad
 * daty, jaká v produkci nikdy nevzniknou — to je horší než žádný seed.
 * Uživatelé se ze stejného důvodu zakládají přes `createOrGetGuestUser`.
 *
 * ── Úklid ────────────────────────────────────────────────────────────────────
 * `cleanup()` zavírá pool testu, PAK líný pool z `rls-pool` (jinak Neon zmizí
 * pod otevřenými sockety → `Connection terminated unexpectedly` jako unhandled
 * error → vitest exit 1 i při zelených testech), a teprve pak maže větev.
 * Data se neuklízejí zvlášť — zaniknou s větví.
 */
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { readdirSync } from 'fs';
import { join } from 'path';
import { createLocalLiveClone, hasLocalLiveDb } from './live-local-clone';

const NEON_API = 'https://console.neon.tech/api/v2';
const PROJECT = 'fragrant-wildflower-75132205';
const PARENT_BRANCH = 'br-rough-paper-alom0zky';
const DB_NAME = 'neondb';
const ROLE = 'neondb_owner';

/**
 * Migrace, které ještě NEJSOU na produkci → klon je bez nich.
 *
 * ⚠️ Seznam se čte z disku, NENÍ zadrátovaný. Dřív tu byl pevný výčet
 * 450–452, takže po přidání 453–457 testovala sada schéma o pět migrací
 * pozadu — nástroj měřil něco jiného, než co poběží. Táž třída jako pevně
 * zadaná role `neondb_owner` (FINDINGS §77, §78): obojí tiše posunulo
 * měřenou realitu vedle skutečné.
 *
 * Baseline a globals se přeskakují — klon se dělá z produkční větve, kde
 * schéma už je; aplikují se jen migrace NAD ním.
 */
function discoverPendingMigrations(): string[] {
  return readdirSync(join('..', 'migrations'))
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))   // 000_baseline* má prefix 000 → vypadne níž
    .filter((f) => !f.startsWith('000_'))
    .sort();
}

export const PENDING_MIGRATIONS: string[] = discoverPendingMigrations();

export const hasNeonKey = Boolean(process.env.NEON_API_KEY);
/**
 * Kolo 14 / krok 4: live testy dřív běžely JEN proti Neon klonu (v CI i lokálně přeskočené). Bez NEON_API_KEY a s
 * FIX_E2E=1 jdou proti lokální DB z migrací (tests/helpers/live-local-clone) — v CI live sadě i lokálně.
 */
export const hasLiveDb = hasNeonKey || hasLocalLiveDb;

async function neon(path: string, init: RequestInit = {}) {
  const res = await fetch(NEON_API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.NEON_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Neon API ${res.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

export interface LiveClone {
  pool: Pool;
  branchId: string;
  uri: string;
  cleanup: () => Promise<void>;
}

/**
 * Vytvoří ephemeral větev z produkční, aplikuje nenasazené migrace a nastaví
 * `DATABASE_URL`, aby route handlery mířily na klon.
 */
export async function createLiveClone(
  label: string,
  opts: { migrations?: string[]; exclude?: string[] } = {},
): Promise<LiveClone> {
  if (!hasNeonKey) return createLocalLiveClone(label, opts);
  const created = await neon(`/projects/${PROJECT}/branches`, {
    method: 'POST',
    body: JSON.stringify({
      branch: { parent_id: PARENT_BRANCH, name: `${label}-${Date.now()}` },
      endpoints: [{ type: 'read_write' }],
    }),
  });
  const branchId: string = created.branch.id;

  // Neon compute potřebuje chvíli, než endpoint odpovídá.
  await new Promise((r) => setTimeout(r, 4000));
  const { uri } = await neon(
    `/projects/${PROJECT}/connection_uri?branch_id=${branchId}` +
      // `pooled=false` je POVINNE. Bez nej vrati Neon `-pooler` endpoint, kde
      // vsechna spojeni sdili JEDEN backend (zmereno: 16 spojeni -> 1 pid).
      // Cerstvy `new Client()` pak zdedi GUC po predchozim mereni — presne to
      // vyrobilo falesny unik v §186 a je to i mechanismus R-15.
      `&role_name=${ROLE}&database_name=${DB_NAME}&pooled=false`,
  );

  process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
  // Vydávání lístků šifruje TOTP secret — bez klíče issuer spadne.
  process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);

  // Seed a asserty jdou VŽDY přes owner pool (ground truth, bypassrls).
  const pool = new Pool({ connectionString: uri, max: 6 });

  // ── POD JAKOU ROLÍ BĚŽÍ HANDLERY ──────────────────────────────────────────
  // DEFAULT je `tixly_app` (BYPASSRLS=false) — tedy role, kterou má používat
  // produkce. Owner jen na výslovné vyžádání přes `LIVE_AS_OWNER=1`.
  //
  // Proč se to otočilo: dřív byl default `neondb_owner`, který RLS MÍJÍ.
  // Live sada tím systematicky hlásila „PROŠLO" u cest, které pod produkční
  // rolí padají na 42501 — a stalo se to dvakrát (FINDINGS §31, §77).
  // Zápis do dokumentu to nezastavil, takže obrana patří sem, do nástroje.
  //
  // `LIVE_AS_OWNER=1` je legitimní jen tam, kde test měří něco JINÉHO než
  // oprávnění a RLS by mu stálo v cestě — a musí být u toho napsáno proč.
  const asOwner = process.env.LIVE_AS_OWNER === '1';
  if (asOwner) {
    process.env.DATABASE_URL = uri;
  } else {
    const pw = `LiveTest_${randomUUID().slice(0, 12)}`;
    await pool.query(`ALTER ROLE tixly_app WITH PASSWORD '${pw}'`);
    process.env.DATABASE_URL = uri.replace(/\/\/[^@]+@/, `//tixly_app:${pw}@`);
  }
  // Hlasitě, ať se z toho nestane tichý předpoklad jako minule.
  console.log(`[live-fixture] handlery běží jako: ${asOwner ? 'neondb_owner (BYPASSRLS — RLS SE NEMĚŘÍ)' : 'tixly_app (RLS platí)'}`);

  // `exclude` je RED stav pro RED->GREEN test (§187): klon jinak aplikuje VSECHNY
  // soubory z ../migrations vcetne te, kterou testujes, takze "pred" a "po" jsou
  // dvakrat "po". Staci prefix cisla — `exclude: ['471']`.
  const skip = (f: string) => (opts.exclude ?? []).some((x) => f.startsWith(x));
  const chosen = (opts.migrations ?? PENDING_MIGRATIONS).filter((f) => !skip(f));
  if (opts.exclude?.length) {
    console.log(`[live-fixture] RED stav — vynechano: ${opts.exclude.join(', ')}`);
  }
  for (const file of chosen) {
    // `../migrations` — migrace se archivačním commitem `fc95cb2` sloučily do
    // JEDINÉ kořenové složky; `nextjs-boilerplate/migrations/` zanikla.
    const sql = await readFile(join('..', 'migrations', file), 'utf8');
    await pool.query(sql);
  }

  const cleanup = async (): Promise<void> => {
    await pool.end().catch(() => undefined);
    try {
      const { db: appDb } = await import('@/lib/db/rls-pool');
      await appDb().end();
    } catch {
      /* nikdy neinicializován / už zavřený */
    }
    await neon(`/projects/${PROJECT}/branches/${branchId}`, { method: 'DELETE' }).catch((e) =>
      console.error('[live-fixture] větev NESMAZÁNA:', branchId, e),
    );
  };

  return { pool, branchId, uri, cleanup };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Seed factory
// ═══════════════════════════════════════════════════════════════════════════════

export interface SeededChain {
  promoterId: string;
  adminUserId: string;
  venueId: string;
  eventId: string;
  ticketTypeId: string;
}

export interface SeededOrder {
  orderId: string;
  userId: string;
  email: string;
}

export function makeSeed(pool: Pool, runId: string = String(Date.now())) {
  const uniq = (p: string) => `${p}-${runId}-${Math.random().toString(36).slice(2, 7)}`;
  const mail = (p: string) => `${uniq(p)}@tixly.test`;

  /**
   * Uživatel přes sdílený helper — tentýž vzor jako produkční guest-create
   * (partial ON CONFLICT, `gdpr_consent_at`, sentinel `!guest`).
   */
  async function user(label = 'u', name = 'Test User'): Promise<{ id: string; email: string }> {
    const { createOrGetGuestUser } = await import('@/lib/identity/guest-user');
    const email = mail(label);
    const id = await createOrGetGuestUser(pool, { email, name });
    return { id, email };
  }

  /**
   * promoter → venue → event → ticket_type.
   * Dodává VŠECHNY NOT NULL sloupce bez defaultu — právě na nich se každá
   * ručně psaná kopie seedu zasekla (`promoters.email` je jiný sloupec než
   * `contact_email`, `venues` chce `city`/`country`/`capacity`, `events` chce
   * `organizer_id` i `title`).
   */
  async function chain(
    opts: {
      remainingQty?: number;
      totalQty?: number;
      basePrice?: number;
      kind?: string;
      status?: string;
      currency?: string;
      /** Kolo 7 (C-54): sazba DPH typu vstupenky; null = bez sazby (plátce pak nemůže prodávat). */
      vatRateCode?: string | null;
      /** Kolo 7: plátce DPH (výchozí true jako v DB) s platným DIČ. */
      vatPayer?: boolean;
      dic?: string | null;
    } = {},
  ): Promise<SeededChain> {
    const {
      remainingQty = 100,
      totalQty = 100,
      basePrice = 10000,
      kind = 'standing',
      status = 'published',
      currency = 'CZK',
      vatRateCode = 'CZ_REDUCED',
      vatPayer = true,
      dic = 'CZ12345678',
    } = opts;

    const admin = await user('admin', 'Admin');
    const promoterId = randomUUID();
    const venueId = randomUUID();
    const eventId = randomUUID();
    const ticketTypeId = randomUUID();

    const promoterEmail = mail('promoter');
    await pool.query(
      `INSERT INTO platform.promoters (id, name, email, contact_email, slug, vat_payer, company_dic)
       VALUES ($1, 'Test Promoter', $2, $2, $3, $4, $5)`,
      [promoterId, promoterEmail, uniq('promoter'), vatPayer, dic],
    );
    await pool.query(
      `INSERT INTO platform.promoter_members (promoter_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [promoterId, admin.id],
    );
    await pool.query(
      `INSERT INTO catalog.venues (id, name, city, country, capacity)
       VALUES ($1, 'Test Sál', 'Praha', 'CZ', 500)`,
      [venueId],
    );
    await pool.query(
      `INSERT INTO catalog.events
         (id, organizer_id, promoter_id, venue_id, title, slug, status, currency,
          event_type, date_start)
       VALUES ($1, $2, $2, $3, 'Test Akce', $4, $5, $6, 'concert',
               NOW() + INTERVAL '30 days')`,
      [eventId, promoterId, venueId, uniq('event'), status, currency],
    );
    await pool.query(
      `INSERT INTO catalog.ticket_types
         (id, event_id, name, kind, base_price, total_qty, remaining_qty, visibility, vat_rate_code)
       VALUES ($1, $2, 'Standard', $3, $4, $5, $6, 'public', $7)`,
      [ticketTypeId, eventId, kind, basePrice, totalQty, remainingQty, vatRateCode],
    );

    return { promoterId, adminUserId: admin.id, venueId, eventId, ticketTypeId };
  }

  /**
   * Objednávka + položky. `expires_at` je na orders.orders NOT NULL BEZ defaultu
   * — dodává se vždy, jinak 23502.
   */
  async function order(
    c: SeededChain,
    opts: { userId?: string; quantity?: number; status?: string; unitPrice?: number } = {},
  ): Promise<SeededOrder> {
    const { quantity = 1, status = 'paid', unitPrice = 10000 } = opts;
    const buyer = opts.userId
      ? { id: opts.userId, email: '' }
      : await user('buyer', 'Test Buyer');
    const orderId = randomUUID();
    await pool.query(
      `INSERT INTO orders.orders
         (id, user_id, event_id, status, total_amount, currency, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'CZK', NOW() + INTERVAL '1 day')`,
      [orderId, buyer.id, c.eventId, status, unitPrice * quantity],
    );
    await pool.query(
      `INSERT INTO orders.order_items
         (order_id, ticket_type_id, quantity, unit_price, total_price)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, c.ticketTypeId, quantity, unitPrice, unitPrice * quantity],
    );
    return { orderId, userId: buyer.id, email: buyer.email };
  }

  /**
   * Vydá lístky PRODUKČNÍ cestou.
   *
   * Nikdy nedělej `INSERT INTO tickets.tickets` ručně — tabulka má řetěz
   * povinných sloupců (`original_owner_id`, `totp_secret_encrypted`,
   * `totp_secret_iv`, `original_price`), jejichž správné hodnoty zná jen issuer.
   * Vyžaduje migraci 450 (`ticket_seq` + UNIQUE), kterou createLiveClone aplikuje.
   */
  async function tickets(orderId: string) {
    const { issueTicketsForOrder } = await import('@/lib/tickets/demo-issuer');
    return issueTicketsForOrder(orderId, pool);
  }

  /** Zkratka: celý řetěz až po vydaný lístek. */
  async function fullChain(opts: Parameters<typeof chain>[0] = {}) {
    const c = await chain(opts);
    const o = await order(c);
    const issued = await tickets(o.orderId);
    return { ...c, ...o, tickets: issued };
  }

  return { uniq, mail, user, chain, order, tickets, fullChain };
}

export type Seed = ReturnType<typeof makeSeed>;
