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
import { join } from 'path';

const NEON_API = 'https://console.neon.tech/api/v2';
const PROJECT = 'fragrant-wildflower-75132205';
const PARENT_BRANCH = 'br-rough-paper-alom0zky';
const DB_NAME = 'neondb';
const ROLE = 'neondb_owner';

/** Migrace, které ještě NEJSOU na produkci → klon je bez nich. */
export const PENDING_MIGRATIONS = [
  '450_tickets_dedup_unique.sql',
  '451_orders_payment_provider_pos.sql',
  '452_tracking_events_provider_tiktok.sql',
];

export const hasNeonKey = Boolean(process.env.NEON_API_KEY);

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
  opts: { migrations?: string[] } = {},
): Promise<LiveClone> {
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
      `&role_name=${ROLE}&database_name=${DB_NAME}`,
  );

  process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
  // Vydávání lístků šifruje TOTP secret — bez klíče issuer spadne.
  process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);

  // Seed a asserty jdou VŽDY přes owner pool (ground truth, bypassrls).
  const pool = new Pool({ connectionString: uri, max: 6 });

  // `LIVE_AS_APP_ROLE=1` → route handlery se připojí jako `tixly_app`
  // (BYPASSRLS=false), tedy pod rolí, kterou má používat produkce.
  // Default zůstává `neondb_owner`, aby se stávající sada nechovala jinak.
  //
  // Proč to existuje: všechna dosavadní měření běžela jako owner, který
  // granty nepotřebuje a RLS ho míjí → výsledky byly systematicky
  // optimistické o celou vrstvu oprávnění (FINDINGS §30).
  if (process.env.LIVE_AS_APP_ROLE === '1') {
    const pw = `LiveTest_${randomUUID().slice(0, 12)}`;
    await pool.query(`ALTER ROLE tixly_app WITH PASSWORD '${pw}'`);
    process.env.DATABASE_URL = uri.replace(/\/\/[^@]+@/, `//tixly_app:${pw}@`);
  } else {
    process.env.DATABASE_URL = uri;
  }

  for (const file of opts.migrations ?? PENDING_MIGRATIONS) {
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
    } = {},
  ): Promise<SeededChain> {
    const {
      remainingQty = 100,
      totalQty = 100,
      basePrice = 10000,
      kind = 'standing',
      status = 'published',
      currency = 'CZK',
    } = opts;

    const admin = await user('admin', 'Admin');
    const promoterId = randomUUID();
    const venueId = randomUUID();
    const eventId = randomUUID();
    const ticketTypeId = randomUUID();

    const promoterEmail = mail('promoter');
    await pool.query(
      `INSERT INTO platform.promoters (id, name, email, contact_email, slug)
       VALUES ($1, 'Test Promoter', $2, $2, $3)`,
      [promoterId, promoterEmail, uniq('promoter')],
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
         (id, event_id, name, kind, base_price, total_qty, remaining_qty, visibility)
       VALUES ($1, $2, 'Standard', $3, $4, $5, $6, 'public')`,
      [ticketTypeId, eventId, kind, basePrice, totalQty, remainingQty],
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
