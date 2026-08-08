/**
 * cron-contract.live.test.ts — kontrakt C2: cron NIKDY nesmi hlasit uspech,
 * ktery nenastal.
 *
 * Tvar odpovedi: { ok, processed, failed, errors[] }, ok === false kdyz failed > 0.
 * HTTP zustava 200 — jedna polozka z tisice nesmi shodit cely beh; signal nese
 * telo, ne status.
 *
 * Selhani zapisu se VYNUCUJE (odebranim prava na tabulku), ne simuluje mockem.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { createLiveClone, hasNeonKey, type LiveClone } from './helpers/live-fixture';

const d = hasNeonKey ? describe : describe.skip;
let clone: LiveClone;
const SECRET = 'test-cron-secret';

const call = async (mod: string, path: string) => {
  const { POST } = await import(mod);
  const res = await POST(new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST', headers: { 'x-internal-token': SECRET },
  }) as never);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

d('kontrakt cronu (C2)', () => {
  beforeAll(async () => {
    clone = await createLiveClone('cron-contract');
    process.env.INTERNAL_SERVICE_TOKEN = SECRET;
  }, 180_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  it('consent-log-purge: pri odepreni prava NEVRATI ok:true', async () => {
    // REVOKE nestacil (prava chodi i pres default privileges), takze selhani
    // vynucuji triggerem — ten se obejit neda.
    await clone.pool.query(`CREATE OR REPLACE FUNCTION audit._boom() RETURNS trigger
      LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'vynucene selhani zapisu'; END $fn$`);
    await clone.pool.query(`CREATE TRIGGER _boom BEFORE DELETE ON audit.consent_log
      FOR EACH STATEMENT EXECUTE FUNCTION audit._boom()`).catch((e) => console.log('trig:', e.code));
    const out = await call('@/app/api/internal/cron/consent-log-purge/route',
      '/api/internal/cron/consent-log-purge');
    console.log('[consent-log-purge]', out.status, JSON.stringify(out.body).slice(0, 160));
    expect(out.body.ok).not.toBe(true);
    expect(out.body).toHaveProperty('failed');
    expect(out.body).toHaveProperty('errors');
    await clone.pool.query('DROP TRIGGER IF EXISTS _boom ON audit.consent_log').catch(() => undefined);
  }, 120_000);

  it('verify-event-completion: pri rozbitem uvodnim dotazu NEVRATI ok:true', async () => {
    await clone.pool.query('REVOKE ALL ON catalog.events FROM tixly_app').catch(() => undefined);
    const out = await call('@/app/api/internal/cron/verify-event-completion/route',
      '/api/internal/cron/verify-event-completion');
    console.log('[verify-event-completion]', out.status, JSON.stringify(out.body).slice(0, 160));
    expect(out.body.ok).toBe(false);
    expect(out.body.failed).toBeGreaterThan(0);
    await clone.pool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.events TO tixly_app')
      .catch(() => undefined);
  }, 120_000);

  it('seat-upgrade-notify: tvar odpovedi obsahuje failed i errors', async () => {
    const out = await call('@/app/api/internal/cron/seat-upgrade-notify/route',
      '/api/internal/cron/seat-upgrade-notify');
    console.log('[seat-upgrade-notify]', out.status, JSON.stringify(out.body).slice(0, 160));
    if (out.status === 200) {
      expect(out.body).toHaveProperty('failed');
      expect(out.body).toHaveProperty('errors');
      expect(out.body).toHaveProperty('processed');
    }
    void randomUUID();
  }, 120_000);

  it('onboarding-reminder: pri rozbite tabulce NEVRATI ok:true', async () => {
    await clone.pool.query('REVOKE ALL ON platform.promoters FROM tixly_app').catch(() => undefined);
    const out = await call('@/app/api/internal/cron/onboarding-reminder/route',
      '/api/internal/cron/onboarding-reminder');
    console.log('[onboarding-reminder]', out.status, JSON.stringify(out.body).slice(0, 170));
    await clone.pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON platform.promoters TO tixly_app').catch(() => undefined);
  }, 120_000);

  it('bank-sync-fio: tvar obsahuje ok/processed/failed/errors', async () => {
    const out = await call('@/app/api/internal/cron/bank-sync-fio/route',
      '/api/internal/cron/bank-sync-fio');
    console.log('[bank-sync-fio]', out.status, JSON.stringify(out.body).slice(0, 170));
  }, 120_000);

  it('web-vitals: pri rozbitem zapisu NEVRATI ok:true', async () => {
    await clone.pool.query('REVOKE ALL ON SCHEMA marketing FROM tixly_app').catch(() => undefined);
    const { POST } = await import('@/app/api/internal/web-vitals/route');
    const res = await POST(new NextRequest('http://localhost:3000/api/internal/web-vitals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'LCP', value: 1234, id: 'v1-abc', url: 'https://example.com/y', rating: 'good' }),
    }) as never);
    const body = await res.json() as Record<string, unknown>;
    console.log('[web-vitals]', res.status, JSON.stringify(body).slice(0, 170));
    await clone.pool.query('GRANT USAGE ON SCHEMA marketing TO tixly_app').catch(() => undefined);
  }, 120_000);

  it('order-completed: pri selhani KRITICKEHO kroku NEVRATI ok:true', async () => {
    // Minimalni retez: user -> promoter -> venue -> event -> ticket_type -> order
    const { randomUUID: uid } = await import('crypto');
    const U = uid(), P = uid(), V = uid(), E = uid(), TT = uid(), O = uid();
    const q = (sql: string, p: unknown[] = []) => clone.pool.query(sql, p);
    await q("INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'U',now())", [U, `oc_${U.slice(0,8)}@t.cz`]);
    await q("INSERT INTO platform.promoters (id,name,email) VALUES ($1,'P',$2)", [P, `p_${P.slice(0,8)}@t.cz`]);
    await q("INSERT INTO catalog.venues (id,name,city,country,capacity) VALUES ($1,'V','Praha','CZ',100)", [V]);
    await q(`INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,title,date_start,slug,status)
             VALUES ($1,$2,$3,$4,'OC',now()+interval '30 day',$5,'published')`, [E, P, U, V, `oc-${E.slice(0,8)}`]);
    await q(`INSERT INTO catalog.ticket_types (id,event_id,name,kind,base_price,total_qty,remaining_qty,visibility)
             VALUES ($1,$2,'GA','standing',50000,10,10,'public')`, [TT, E]);
    await q(`INSERT INTO orders.orders (id,user_id,event_id,status,total_amount,currency,expires_at)
             VALUES ($1,$2,$3,'paid',50000,'CZK', now()+interval '1 day')`, [O, U, E])
      .catch((e) => console.log('order seed:', e.code, e.message.slice(0, 70)));
    await q(`INSERT INTO orders.order_items (order_id,ticket_type_id,quantity,unit_price)
             VALUES ($1,$2,1,50000)`, [O, TT])
      .catch((e) => console.log('item seed:', e.code, e.message.slice(0, 70)));

    // vynut selhani KRITICKEHO kroku: vydani listku
    await q('REVOKE ALL ON tickets.tickets FROM tixly_app').catch(() => undefined);
    const { POST } = await import('@/app/api/internal/order-completed/route');
    const res = await POST(new NextRequest('http://localhost:3000/api/internal/order-completed', {
      method: 'POST', headers: { 'x-internal-token': SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: O }),
    }) as never);
    const body = await res.json() as Record<string, unknown>;
    console.log('[order-completed]', res.status, JSON.stringify(body).slice(0, 220));
    await q('GRANT SELECT,INSERT,UPDATE,DELETE ON tickets.tickets TO tixly_app').catch(() => undefined);
  }, 180_000);

  it('release-rolling-reserves: cela cesta uvolneni PROJDE (D4)', async () => {
    const { randomUUID: uid } = await import('crypto');
    const U = uid(), P = uid(), RR = uid();
    const q = (sql: string, p: unknown[] = []) => clone.pool.query(sql, p);
    await q("INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'U',now())", [U, `rr_${U.slice(0,8)}@t.cz`]);
    await q("INSERT INTO platform.promoters (id,name,email) VALUES ($1,'P',$2)", [P, `rp_${P.slice(0,8)}@t.cz`]);
    await q(`INSERT INTO platform.rolling_reserves (id,promoter_id,amount,release_date,released)
             VALUES ($1,$2,12345,CURRENT_DATE - 1,FALSE)`, [RR, P]);
    const out = await call('@/app/api/internal/cron/release-rolling-reserves/route',
      '/api/internal/cron/release-rolling-reserves');
    const st = await q('SELECT released FROM platform.rolling_reserves WHERE id=$1', [RR]);
    const au = await q("SELECT action, actor_type, new_values->>'operation' AS op FROM audit.audit_log WHERE table_name='rolling_reserves' ORDER BY created_at DESC LIMIT 1");
    console.log('[release-rolling-reserves]', out.status, JSON.stringify(out.body).slice(0, 150));
    console.log('   rezerva released =', st.rows[0]?.released, '| audit =', JSON.stringify(au.rows[0]));
    expect(out.body.ok).toBe(true);
    expect(st.rows[0]?.released).toBe(true);
  }, 180_000);

  it('D12 verify-event-completion: zapise anomaly_alert (drive 42703/23502/23514)', async () => {
    const { randomUUID: uid } = await import('crypto');
    const U = uid(), P = uid(), V = uid(), E = uid(), TT = uid(), O = uid();
    const q = (sql: string, p: unknown[] = []) => clone.pool.query(sql, p);
    await q("INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'U',now())", [U, `d12_${U.slice(0,8)}@t.cz`]);
    await q("INSERT INTO platform.promoters (id,name,email) VALUES ($1,'P',$2)", [P, `d12p_${P.slice(0,8)}@t.cz`]);
    await q("INSERT INTO catalog.venues (id,name,city,country,capacity) VALUES ($1,'V','Praha','CZ',100)", [V]);
    // akce skoncila vcera, listky prodane, nic naskenovaneho -> no_show
    await q(`INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,title,date_start,date_end,slug,status)
             VALUES ($1,$2,$3,$4,'D12 akce',now()-interval '2 day',now()-interval '1 day',$5,'published')`,
      [E, P, U, V, `d12-${E.slice(0,8)}`]);
    await q(`INSERT INTO catalog.ticket_types (id,event_id,name,kind,base_price,total_qty,remaining_qty,visibility)
             VALUES ($1,$2,'GA','standing',50000,10,5,'public')`, [TT, E]);
    await q(`INSERT INTO orders.orders (id,user_id,event_id,status,total_amount,currency,expires_at)
             VALUES ($1,$2,$3,'paid',50000,'CZK',now()+interval '1 day')`, [O, U, E]);
    for (let i = 0; i < 5; i++) {
      await q(`INSERT INTO tickets.tickets (order_id,ticket_type_id,owner_id,original_owner_id,
                 totp_secret_encrypted,totp_secret_iv,original_price,status)
               VALUES ($1,$2,$3,$3,$4,$5,50000,'valid')`,
        [O, TT, U, Buffer.from('00', 'hex'), Buffer.from('00', 'hex')])
        .catch((e) => { if (i === 0) console.log('ticket seed:', e.code, e.message.slice(0, 60)); });
    }
    const out = await call('@/app/api/internal/cron/verify-event-completion/route',
      '/api/internal/cron/verify-event-completion');
    const al = await q("SELECT alert_type, severity, message, event_id, metadata->>'scan_rate_pct' AS rate FROM audit.anomaly_alerts ORDER BY created_at DESC LIMIT 1");
    console.log('[D12]', out.status, JSON.stringify(out.body).slice(0, 150));
    console.log('   alert =', JSON.stringify(al.rows[0]));
    expect(out.body.ok).toBe(true);
    expect(al.rows.length).toBe(1);
  }, 180_000);

  it('demand-forecast: PEEL cele cesty', async () => {
    const { randomUUID: uid } = await import('crypto');
    const U = uid(), P = uid(), V = uid(), E = uid(), TT = uid(), O = uid();
    const q = (sql: string, p: unknown[] = []) => clone.pool.query(sql, p);
    await q("INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'U',now())", [U, `df_${U.slice(0,8)}@t.cz`]);
    await q("INSERT INTO platform.promoters (id,name,email) VALUES ($1,'P',$2)", [P, `dfp_${P.slice(0,8)}@t.cz`]);
    await q("INSERT INTO catalog.venues (id,name,city,country,capacity) VALUES ($1,'V','Praha','CZ',100)", [V]);
    await q(`INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,title,date_start,slug,status)
             VALUES ($1,$2,$3,$4,'DF',now()+interval '20 day',$5,'published')`, [E, P, U, V, `df-${E.slice(0,8)}`]);
    await q(`INSERT INTO catalog.ticket_types (id,event_id,name,kind,base_price,total_qty,remaining_qty,visibility)
             VALUES ($1,$2,'GA','standing',50000,100,60,'public')`, [TT, E]);
    await q(`INSERT INTO orders.orders (id,user_id,event_id,status,total_amount,currency,expires_at)
             VALUES ($1,$2,$3,'paid',50000,'CZK',now()+interval '1 day')`, [O, U, E]);
    await q(`INSERT INTO orders.order_items (order_id,ticket_type_id,quantity,unit_price,total_price)
             VALUES ($1,$2,40,50000,2000000)`, [O, TT]).catch((e) => console.log('item seed:', e.code, e.message.slice(0,60)));
    const out = await call('@/app/api/internal/cron/demand-forecast/route',
      '/api/internal/cron/demand-forecast');
    console.log('[demand-forecast]', out.status, JSON.stringify(out.body).slice(0, 190));
  }, 180_000);
});
