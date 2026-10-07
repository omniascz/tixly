/**
 * publish-events.live.test.ts — PUT /api/v1/publish/events/[externalId]
 *
 * Posledni ze tri cest opravenych v ramci rename capacity_remaining, ktera
 * dosud bezela jen pres tsc. Opraveno tam bylo:
 *   capacity_remaining -> remaining_qty
 *   price_halire       -> base_price
 * Obe pouzita ve stejnem UPDATE (ttUpdates), takze staci jeden pruchod.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'crypto';
import { createLiveClone, hasLiveDb, type LiveClone } from './helpers/live-fixture';

const d = hasLiveDb ? describe : describe.skip;

let clone: LiveClone;
// format vyzadovany TOKEN_REGEX v b2b-auth.ts:32
const TOKEN = 'tick_live_' + randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8);
const EXTERNAL_ID = `ext-${randomUUID().slice(0, 8)}`;
const ids = {
  user: randomUUID(), promoter: randomUUID(), venue: randomUUID(),
  event: randomUUID(), ticketType: randomUUID(), keyId: randomUUID(),
};

d('v1/publish/events PUT pres skutecny handler', () => {
  beforeAll(async () => {
    clone = await createLiveClone('publish-events');
    const q = (s: string, p: unknown[] = []) => clone.pool.query(s, p);
    await q('INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,$3,now())',
      [ids.user, `pe_${ids.user.slice(0, 8)}@t.cz`, 'U']);
    await q('INSERT INTO platform.promoters (id,name,email) VALUES ($1,$2,$3)',
      [ids.promoter, 'P', `p_${ids.promoter.slice(0, 8)}@t.cz`]);
    await q("INSERT INTO catalog.venues (id,name,city,country,capacity) VALUES ($1,'V','Praha','CZ',100)",
      [ids.venue]);
    // udalost musi byt dohledatelna pres source_system/source_event_id
    await q(`INSERT INTO catalog.events
               (id,promoter_id,organizer_id,venue_id,title,date_start,slug,status,
                source_system,source_event_id)
             VALUES ($1,$2,$3,$4,'E',now()+interval '30 day',$5,'published','external',$6)`,
      [ids.event, ids.promoter, ids.user, ids.venue, `ev-${ids.event.slice(0, 8)}`,
       `${ids.keyId}:${EXTERNAL_ID}`]);
    await q(`INSERT INTO catalog.ticket_types
               (id,event_id,name,kind,base_price,total_qty,remaining_qty,visibility)
             VALUES ($1,$2,'GA','standing',50000,100,100,'public')`,
      [ids.ticketType, ids.event]);
    // B2B klic: verifyB2bToken hleda sha256(token) v b2b.api_keys
    await q(`INSERT INTO b2b.api_keys
               (id,promoter_id,name,token_hash,token_prefix,scope,environment)
             VALUES ($1,$2,'harness',$3,$4,$5,'live')`,
      [ids.keyId, ids.promoter, createHash('sha256').update(TOKEN).digest('hex'),
       TOKEN.slice(0, 12), ['publish:write']]);
  }, 180_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  it('PUT projde a zapise base_price + remaining_qty (drive 42703)', async () => {
    const { PUT } = await import('@/app/api/v1/publish/events/[externalId]/route');
    const res = await PUT(new Request(
      `http://localhost:3000/api/v1/publish/events/${EXTERNAL_ID}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          title: 'Updated title',
          tickets: [{ externalId: 'GA', availableCount: 42, price: 33000 }],
        }),
      }) as never, { params: { externalId: EXTERNAL_ID } } as never);
    const body = await res.json();
    console.log('[publish PUT]', res.status, JSON.stringify(body).slice(0, 200));
    expect(res.status).not.toBe(500);   // 42703 by se projevil jako 500

    if (res.status === 200) {
      const tt = (await clone.pool.query<{ base_price: number; remaining_qty: number }>(
        'SELECT base_price, remaining_qty FROM catalog.ticket_types WHERE id = $1',
        [ids.ticketType])).rows[0];
      console.log('[ticket_type]', tt);
      expect(Number(tt.base_price)).toBe(33000);
      // LEAST(remaining_qty, 42) ze 100 -> 42
      expect(Number(tt.remaining_qty)).toBe(42);
    }
  }, 120_000);
});
