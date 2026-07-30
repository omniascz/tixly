// @vitest-environment node
/**
 * Diagnostický test: N nákupů za sebou proti témuž eventu.
 *
 * Účel je zjistit, jestli je pád audit triggeru (`actor_type = ''` →
 * audit_log_actor_type_check) vázaný na konkrétní změnu kódu, nebo jestli
 * jde o latentní vadu, která se projeví při opakovaném použití spojení z poolu.
 * Pouští se proti PŘED i PO verzi `checkout/route.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';

const NEON_API = 'https://console.neon.tech/api/v2';
const PROJECT = 'fragrant-wildflower-75132205';
const PARENT_BRANCH = 'br-rough-paper-alom0zky';
const DB_NAME = 'neondb';
const ROLE = 'neondb_owner';
const PENDING_MIGRATIONS = [
  '450_tickets_dedup_unique.sql',
  '451_orders_payment_provider_pos.sql',
  '452_tracking_events_provider_tiktok.sql',
];

const apiKey = process.env.NEON_API_KEY;

async function neon(path: string, init: RequestInit = {}) {
  const res = await fetch(NEON_API + path, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Neon API ${res.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

// Tenhle test SELHÁVÁ ZÁMĚRNĚ — je to reprodukovač předexistující vady
// (audit_trigger_func + RESET custom GUC → actor_type=''), ne regresní test.
// Nepouští se sám; zapni ho explicitně:
//   NEON_API_KEY=... RUN_AUDIT_REPRO=1 npx vitest run --config vitest.live.config.ts tests/checkout-stress.live.test.ts
describe.skipIf(!apiKey || !process.env.RUN_AUDIT_REPRO)(
  'checkout — série nákupů (reprodukovač předexistující vady audit/pool)', () => {
  let branchId: string | null = null;
  let pool: Pool;
  let POST: (req: NextRequest) => Promise<Response>;

  const run = `${Date.now()}`;
  const promoterId = randomUUID();
  const venueId = randomUUID();
  const eventId = randomUUID();
  const ticketTypeId = randomUUID();

  beforeAll(async () => {
    const created = await neon(`/projects/${PROJECT}/branches`, {
      method: 'POST',
      body: JSON.stringify({
        branch: { parent_id: PARENT_BRANCH, name: `checkout-stress-${run}` },
        endpoints: [{ type: 'read_write' }],
      }),
    });
    branchId = created.branch.id;
    await new Promise((r) => setTimeout(r, 4000));
    const { uri } = await neon(
      `/projects/${PROJECT}/connection_uri?branch_id=${branchId}&role_name=${ROLE}&database_name=${DB_NAME}`,
    );
    process.env.DATABASE_URL = uri;
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

    pool = new Pool({ connectionString: uri, max: 4 });
    for (const m of PENDING_MIGRATIONS) {
      await pool.query(await readFile(`migrations/${m}`, 'utf8'));
    }
    await pool.query(`INSERT INTO platform.promoters (id, email, name) VALUES ($1, $2, 'P')`, [
      promoterId,
      `pr-${run}@tixly.test`,
    ]);
    await pool.query(
      `INSERT INTO catalog.venues (id, name, city, country, capacity) VALUES ($1, 'S', 'Praha', 'CZ', 500)`,
      [venueId],
    );
    await pool.query(
      `INSERT INTO catalog.events
         (id, organizer_id, promoter_id, venue_id, title, slug, status, currency, event_type, date_start)
       VALUES ($1, $2, $2, $3, 'Akce', $4, 'published', 'CZK', 'concert', NOW() + INTERVAL '30 days')`,
      [eventId, promoterId, venueId, `ev-${run}`],
    );
    await pool.query(
      `INSERT INTO catalog.ticket_types
         (id, event_id, name, kind, base_price, total_qty, remaining_qty, visibility)
       VALUES ($1, $2, 'Standard', 'standing', 50000, 500, 500, 'public')`,
      [ticketTypeId, eventId],
    );
    ({ POST } = await import('@/app/api/checkout/route'));
  }, 180_000);

  afterAll(async () => {
    if (pool) await pool.end().catch(() => undefined);
    // Viz admin-guest.live.test.ts: líný pool z rls-pool musí zmizet PŘED
    // smazáním větve, jinak `Connection terminated unexpectedly` → exit 1.
    try {
      const { db: appDb } = await import('@/lib/db/rls-pool');
      await appDb().end();
    } catch {
      /* nikdy neinicializován / už zavřený */
    }
    if (branchId) {
      await neon(`/projects/${PROJECT}/branches/${branchId}`, { method: 'DELETE' }).catch((e) =>
        console.error('[cleanup] větev nesmazána:', branchId, e),
      );
    }
  }, 60_000);

  it('6 nákupů po sobě, každý jiný e-mail — všechny musí projít', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const req = new Request('http://localhost:3000/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId,
          ticketTypeId,
          quantity: 1,
          buyerEmail: `stress-${i}-${run}@tixly.test`,
          buyerName: `Kupec ${i}`,
          paymentMethod: 'gopay',
        }),
      });
      const res = await POST(req as unknown as NextRequest);
      statuses.push(res.status);
    }
    // Vypiš pořadí, ať je vidět, KTERÝ v řadě selže.
    console.log('statusy po sobě:', statuses.join(', '));
    expect(statuses.every((s) => s < 400)).toBe(true);
  }, 120_000);
  },
);
