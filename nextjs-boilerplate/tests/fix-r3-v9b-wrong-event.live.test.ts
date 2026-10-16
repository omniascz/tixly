// @vitest-environment node
/**
 * Kolo 3 / krok 4 — V9b: skener u brány akce A2 vpustil vstupenku akce A (týž pořadatel).
 * API `/api/admin/scanner/validate` nevědělo, kterou akci brána obsluhuje (schéma nemělo eventId).
 *
 * Po opravě: API přijímá `eventId` brány; vstupenka jiné akce → 409 `wrong_event`, zůstane
 * `valid` a sken se zaloguje jako denied/wrong_event. Klient skeneru (web admin, offline fronta,
 * mobilní appka pořadatele) eventId posílá. Bez eventId (starší klient) se chová jako dřív.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest) => Promise<Response>;

run('Krok 4 (kolo 3) — V9b: sken vstupenky jiné akce téhož pořadatele', () => {
  let clone: LocalClone;
  let fc: Awaited<ReturnType<LocalClone['seed']['fullChain']>>;
  let eventA2: string;
  let staff: string;
  beforeAll(async () => {
    clone = await createLocalClone();
    fc = await clone.seed.fullChain();
    await clone.pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [fc.promoterId]);
    await clone.pool.query(`UPDATE catalog.events SET qr_policy='static_allowed' WHERE id=$1`, [fc.eventId]);
    eventA2 = randomUUID();
    await clone.pool.query(
      `INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, title, slug, status, currency, event_type, date_start)
       VALUES ($1,$2,$2,$3,'Akce A2',$4,'published','CZK','concert', now() + interval '31 days')`,
      [eventA2, fc.promoterId, fc.venueId, `a2-${eventA2.slice(0, 8)}`]);
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [fc.adminUserId])).rows[0].email;
    const { signAccessToken } = await import('@/lib/auth');
    staff = await signAccessToken({ id: fc.adminUserId, email, name: 'Brána' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: fc.promoterId, status: 'active', role: 'owner' } as never] });
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const scan = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/admin/scanner/validate/route');
    return throughMiddleware(new Request('http://localhost/api/admin/scanner/validate', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${staff}` }, body: JSON.stringify(body) }), POST as H);
  };
  const ticketId = async () => (await clone.pool.query(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [fc.orderId])).rows[0].id as string;
  const status = async (id: string) => (await clone.pool.query(`SELECT status FROM tickets.tickets WHERE id=$1`, [id])).rows[0].status;

  it('brána akce A2 + vstupenka akce A → 409 wrong_event, vstupenka zůstane valid, sken zalogován', async () => {
    const t = await ticketId();
    const r = await scan({ ticketId: t, eventId: eventA2, deviceId: 'gate-a2' });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { result: string }).result).toBe('wrong_event');
    expect(await status(t)).toBe('valid');
    const log = (await clone.pool.query(`SELECT scan_result, denied_reason FROM tickets.scan_logs WHERE ticket_id=$1 ORDER BY scanned_at DESC LIMIT 1`, [t])).rows[0];
    expect(log).toEqual({ scan_result: 'denied', denied_reason: 'wrong_event' });
  });

  it('brána akce A + vstupenka akce A → admitted', async () => {
    const t = await ticketId();
    const r = await scan({ ticketId: t, eventId: fc.eventId, deviceId: 'gate-a' });
    expect(r.status, await r.clone().text()).toBe(200);
    expect(((await r.json()) as { result: string }).result).toBe('admitted');
    expect(await status(t)).toBe('used');
  });

  it('neplatné eventId → 422', async () => {
    expect((await scan({ ticketId: await ticketId(), eventId: 'nope' })).status).toBe(422);
  });

  it('klienti skeneru eventId posílají (web admin, offline fronta, mobilní appka pořadatele)', () => {
    const root = path.resolve(__dirname, '../..');
    const web = readFileSync(path.join(root, 'nextjs-boilerplate/src/app/admin/scanner/page.tsx'), 'utf8');
    expect(web).toMatch(/gate\.eventId \? \{ eventId: gate\.eventId \}/);
    expect(web).toMatch(/case 'wrong_event':/);
    const queue = readFileSync(path.join(root, 'nextjs-boilerplate/src/lib/scanner/offline-queue.ts'), 'utf8');
    expect(queue).toMatch(/eventId\?: string/);
    const mobile = readFileSync(path.join(root, 'mobile-promoter/app/scanner.tsx'), 'utf8');
    expect(mobile).toMatch(/body\.eventId = eventId/);
  });
});
