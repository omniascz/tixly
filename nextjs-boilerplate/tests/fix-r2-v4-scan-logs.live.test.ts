// @vitest-environment node
/**
 * Kolo 2 / krok 5 — V4: každý sken u brány se musí zapsat do `tickets.scan_logs`.
 *
 * Audit: `logScan failed` 25×, `scan_logs` 0 řádků — `scanned_by_device_id` je uuid NOT NULL
 * (webový skener deviceId neposílá, API přijímá libovolný řetězec), zápis byl fire-and-forget.
 * Test: N skenů (vpuštěn, duplicitní, zneplatněná vstupenka; se zařízením i bez, UUID i textové
 * id) přes skutečný middleware a handler pod tixly_app → přesně N řádků se správným výsledkem.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);

run('Krok 5 — V4: N skenů → N řádků ve scan_logs', () => {
  let clone: LocalClone;
  beforeAll(async () => { clone = await createLocalClone(); }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  it('vpuštěn / duplicitní / zneplatněná vstupenka, zařízení UUID / text / žádné → každý sken = 1 řádek', async () => {
    const pool = clone.pool;
    const fc = await clone.seed.fullChain({ totalQty: 10, remainingQty: 7, basePrice: 30000 });
    // 3 vstupenky: druhá objednávka pro další vstupenky
    const o2 = await clone.seed.order(fc, { quantity: 2 });
    await clone.seed.tickets(o2.orderId);
    await pool.query(`UPDATE catalog.events SET qr_policy='static_allowed' WHERE id=$1`, [fc.eventId]);
    await pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [fc.promoterId]).catch(() => {});
    const tks = (await pool.query<{ id: string }>(
      `SELECT t.id FROM tickets.tickets t JOIN orders.orders o ON o.id=t.order_id WHERE o.event_id=$1 ORDER BY t.id`, [fc.eventId])).rows.map((r) => r.id);
    expect(tks.length).toBe(3);
    await pool.query(`UPDATE tickets.tickets SET status='revoked' WHERE id=$1`, [tks[2]]);

    const staff = (await pool.query<{ email: string }>(`SELECT email FROM identity.users WHERE id=$1`, [fc.adminUserId])).rows[0];
    const { signAccessToken } = await import('@/lib/auth');
    const token = await signAccessToken({ id: fc.adminUserId, email: staff.email, name: 'Brána' } as never,
      { isPlatformAdmin: false, promoterMemberships: [{ promoterId: fc.promoterId, status: 'active', role: 'owner' } as never] });
    const { POST } = await import('@/app/api/admin/scanner/validate/route');
    const scan = (body: Record<string, unknown>) => throughMiddleware(new Request('http://localhost/api/admin/scanner/validate', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    }), POST as (r: NextRequest) => Promise<Response>);

    const before = (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM tickets.scan_logs WHERE event_id=$1`, [fc.eventId])).rows[0].n;
    const uuidDev = randomUUID();
    const scans: Array<[Record<string, unknown>, string]> = [
      [{ ticketId: tks[0], deviceId: uuidDev }, 'admitted'],
      [{ ticketId: tks[0], deviceId: uuidDev }, 'already_used'],
      [{ ticketId: tks[1] }, 'admitted'],                       // webový skener: bez deviceId
      [{ ticketId: tks[1], deviceId: 'gate-1-tablet' }, 'already_used'], // textové id zařízení
      [{ ticketId: tks[2], deviceId: 'gate-2' }, 'denied'],     // zneplatněná vstupenka (API: result 'revoked')
    ];
    const results: string[] = [];
    for (const [body] of scans) {
      const r = await scan(body);
      const j = await r.json() as { result?: string };
      expect([200, 403, 409], `HTTP ${r.status}`).toContain(r.status); // duplicitní/odmítnutý sken = 409/403
      results.push(j.result ?? '?');
    }
    expect(results).toEqual(['admitted', 'already_used', 'admitted', 'already_used', 'revoked']);

    const cnt = (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM tickets.scan_logs WHERE event_id=$1`, [fc.eventId])).rows[0].n;
    expect(cnt - before, 'každý sken = právě 1 řádek ve scan_logs').toBe(scans.length);
    const rows = (await pool.query<{ ticket_id: string; scan_result: string; dev: string | null; label: string | null }>(
      `SELECT ticket_id, scan_result, scanned_by_device_id::text dev, device_label label
         FROM tickets.scan_logs WHERE event_id=$1 ORDER BY id`, [fc.eventId])).rows;
    expect(rows.length - before, 'každý sken = právě 1 řádek').toBe(scans.length);
    expect(rows.slice(before).map((r) => r.scan_result)).toEqual(scans.map(([, want]) => want));
    expect(rows[before].dev).toBe(uuidDev);
    expect(rows[before + 3].label).toBe('gate-1-tablet');
  });
});
