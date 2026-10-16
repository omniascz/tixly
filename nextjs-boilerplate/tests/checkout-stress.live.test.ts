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
import { randomUUID } from 'crypto';
import { createLiveClone, hasLiveDb, type LiveClone } from './helpers/live-fixture';




// Tenhle test SELHÁVÁ ZÁMĚRNĚ — je to reprodukovač předexistující vady
// (audit_trigger_func + RESET custom GUC → actor_type=''), ne regresní test.
// Nepouští se sám; zapni ho explicitně:
//   NEON_API_KEY=... RUN_AUDIT_REPRO=1 npx vitest run --config vitest.live.config.ts tests/checkout-stress.live.test.ts
describe.skipIf(!hasLiveDb || !process.env.RUN_AUDIT_REPRO)(
  'checkout — série nákupů (reprodukovač předexistující vady audit/pool)', () => {
  let clone: LiveClone | undefined;
  let pool: Pool;
  let POST: (req: NextRequest) => Promise<Response>;

  const run = `${Date.now()}`;
  const promoterId = randomUUID();
  const venueId = randomUUID();
  const eventId = randomUUID();
  const ticketTypeId = randomUUID();

  beforeAll(async () => {
    // Kolo 14 / krok 4: sdílená dráha — Neon klon, nebo bez NEON_API_KEY lokální DB z migrací (FIX_E2E=1)
    clone = await createLiveClone('checkout-stress');
    pool = clone.pool;
    await pool.query(`INSERT INTO platform.promoters (id, email, name, company_dic) VALUES ($1, $2, 'P', 'CZ12345678')`, [
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
         (id, event_id, name, kind, base_price, total_qty, remaining_qty, visibility, vat_rate_code)
       VALUES ($1, $2, 'Standard', 'standing', 50000, 500, 500, 'public', 'CZ_REDUCED')`, // kolo 14: sazba DPH (C-54)
      [ticketTypeId, eventId],
    );
    ({ POST } = await import('@/app/api/checkout/route'));
  }, 180_000);

  afterAll(async () => {
    await clone?.cleanup();
  }, 60_000);

  it('6 nákupů po sobě, každý jiný e-mail — všechny musí projít', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const req = new Request('http://localhost:3000/api/checkout', {
        method: 'POST',
        // Kolo 14 / krok 4: jeden klient s vlastní IP pro tento běh — limit 10 objednávek / IP / 10 min (FIX K3) je
        // ve sdíleném Redisu, bez IP by všechny běhy sdílely klíč `checkout:ip:unknown` a 429 by měřilo jiný běh.
        headers: { 'content-type': 'application/json', 'x-real-ip': `10.14.${Number(run) % 250}.${Math.floor(Number(run) / 250) % 250}` },
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
