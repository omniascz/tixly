// @vitest-environment node
/**
 * Kolo 3 / krok 3 — 54 výskytů `SET LOCAL app.is_platform_admin = 'true'` (logs/r2/3_inline_escalations.txt)
 * nahrazeno nejužší variantou:
 *   kupec / anonym   → vlastnictví ověřeno pod RLS kontextem uživatele, asSystemInTx jen pro
 *                      systémový příkaz; nebo stačí sám kontext (RLS pokrývá vlastní řádky);
 *   pořadatel        → kontext pořadatele bez admin práv (+ asSystemInTx jen pro systémový příkaz);
 *   systém           → servisní kontext (route už v runWithServiceContext), bez admin práv;
 *   platform admin   → ponecháno jen tam, kde je volající ověřený admin (requirePlatformAdmin = podepsaný JWT).
 * Tabulka soubor | volající | před | po: ESKALACE_R3.md.
 *
 * Část 0 — inventura (RED před opravou: 53 výskytů v kódu).
 * Část 1 — kupec proti cizímu uživateli (vlastní akce funguje, cizí nic nezmění / nevidí).
 * Část 2 — pořadatel proti cizímu pořadateli.
 * Část 3 — anonym a servisní routy fungují bez admin eskalace.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
const FAKE = 'http://localhost:3998';
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;
const SRC = path.resolve(__dirname, '../src');

/** Jediné povolené výskyty: platform admin routy, kde je volající ověřen requirePlatformAdmin (podepsaný JWT). */
const ALLOWED: Record<string, number> = {
  'app/api/platform/travel/hotels/route.ts': 2,
  'app/api/platform/travel/hotels/[hotelId]/route.ts': 3,
  'app/api/platform/travel/hotels/[hotelId]/rooms/route.ts': 2,
  'app/api/platform/venues/[id]/seat-view-photos/route.ts': 2,
  'app/api/platform/venues/[id]/seat-view-photos/[photoId]/route.ts': 1,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

describe('Krok 3 (kolo 3) — inventura admin eskalací', () => {
  it("SET LOCAL app.is_platform_admin = 'true' zůstává jen v ověřených platform admin routách", () => {
    const found: Record<string, number> = {};
    for (const p of walk(SRC)) {
      const rel = path.relative(SRC, p).replace(/\\/g, '/');
      if (rel === 'lib/db/rls-pool.ts') continue; // samotný mechanismus kontextu (runWithPlatformAdminContext)
      const lines = readFileSync(p, 'utf8').split('\n');
      for (const l of lines) {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) continue;
        if (/SET LOCAL app\.is_platform_admin\s*=\s*'true'/.test(l)) found[rel] = (found[rel] ?? 0) + 1;
      }
    }
    expect(found).toEqual(ALLOWED);
    for (const rel of Object.keys(ALLOWED)) {
      const src = readFileSync(path.join(SRC, rel), 'utf8');
      const handlers = (src.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g) ?? []).length;
      const guards = (src.match(/await requirePlatformAdmin\(req\)/g) ?? []).length;
      expect(guards, `${rel}: každý handler ověřuje platform admina`).toBeGreaterThanOrEqual(handlers);
    }
  });
});

run('Krok 3 (kolo 3) — routy po odstranění eskalací', () => {
  let clone: LocalClone;
  let pool: Pool;
  let sign: (u: { id: string; email: string }, memberships?: Array<{ promoterId: string }>) => Promise<string>;

  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
    delete process.env.SPOTIFY_CLIENT_ID;
    const { signAccessToken } = await import('@/lib/auth');
    sign = (u, memberships = []) => signAccessToken({ id: u.id, email: u.email, name: 'T' } as never, {
      isPlatformAdmin: false,
      promoterMemberships: memberships.map((m) => ({ promoterId: m.promoterId, status: 'active', role: 'owner' }) as never),
    });
    (await import('@/lib/payment/gopay-real'))._resetGopayCacheForTests();
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const ip = () => `10.33.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  async function call(method: string, p: string, token: string | null, handler: H, ctx?: unknown, body?: unknown) {
    return throughMiddleware(new Request(`http://localhost${p}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-real-ip': ip(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), handler, ctx);
  }
  const buyer = async (label: string) => {
    const u = await clone.seed.user(label);
    return { ...u, token: await sign(u) };
  };
  async function promoterOf(c: { promoterId: string; adminUserId: string }) {
    await pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [c.promoterId]);
    const email = (await pool.query(`SELECT email FROM identity.users WHERE id=$1`, [c.adminUserId])).rows[0].email;
    return sign({ id: c.adminUserId, email }, [{ promoterId: c.promoterId }]);
  }

  // ───────────────────────── 1: kupec proti cizímu uživateli ─────────────────────────
  describe('1 — kupec', () => {
    async function choiceHolder(userId: string, opts: { credit?: number } = {}) {
      const c = await clone.seed.chain({ remainingQty: 50 });
      const pkg = randomUUID();
      await pool.query(
        `INSERT INTO subscriptions.packages (id, promoter_id, name, slug, season_label, base_price_halire, abo_type, max_picks_for_choice, status)
         VALUES ($1,$2,'Wahl',$3,'2026/27',300000,'choice',3,'on_sale')`, [pkg, c.promoterId, `wahl-${pkg.slice(0, 8)}`]);
      await pool.query(`INSERT INTO subscriptions.package_events (package_id, event_id, order_index) VALUES ($1,$2,1)`, [pkg, c.eventId]);
      const email = (await pool.query(`SELECT email FROM identity.users WHERE id=$1`, [userId])).rows[0].email;
      const holder = randomUUID();
      await pool.query(
        `INSERT INTO subscriptions.holders (id, package_id, user_id, holder_name, holder_email, status, payment_status, valid_until, price_paid_halire, restwert_credit_halire)
         VALUES ($1,$2,$3,'Abonent',$4,'active','paid', now() + interval '1 year', 300000, $5)`, [holder, pkg, userId, email, opts.credit ?? 0]);
      return { ...c, pkg, holder };
    }

    it('restwert-balance: vidím jen vlastní kredit, cizí ne', async () => {
      const a = await buyer('rwa'); const b = await buyer('rwb');
      const h = await choiceHolder(a.id, { credit: 5000 });
      const { GET } = await import('@/app/api/buyer/restwert-balance/route');
      const ra = await call('GET', `/api/buyer/restwert-balance?promoterId=${h.promoterId}`, a.token, GET as H);
      expect(ra.status, await ra.clone().text()).toBe(200);
      expect(((await ra.json()) as { balanceHalire: number }).balanceHalire).toBe(5000);
      const rb = await call('GET', `/api/buyer/restwert-balance?promoterId=${h.promoterId}`, b.token, GET as H);
      expect(((await rb.json()) as { balanceHalire: number }).balanceHalire).toBe(0);
      const rbAll = await call('GET', `/api/buyer/restwert-balance`, b.token, GET as H);
      expect(((await rbAll.json()) as { total: number }).total).toBe(0);
    });

    it('Wahl-Abo pick: cizí kupec nevybere na cizí abonentku ani nezruší cizí výběr; vlastník ano', async () => {
      const a = await buyer('pka'); const b = await buyer('pkb');
      const h = await choiceHolder(a.id);
      const { POST } = await import('@/app/api/buyer/subscriptions/[id]/pick/route');
      const { DELETE } = await import('@/app/api/buyer/subscriptions/[id]/pick/[eventId]/route');
      const redemptions = async () => (await pool.query(`SELECT ticket_id FROM subscriptions.redemptions WHERE holder_id=$1`, [h.holder])).rows;

      const foreign = await call('POST', `/api/buyer/subscriptions/${h.holder}/pick`, b.token, POST as H, { params: { id: h.holder } }, { eventId: h.eventId });
      expect([403, 404]).toContain(foreign.status);
      expect(await redemptions()).toHaveLength(0);

      const own = await call('POST', `/api/buyer/subscriptions/${h.holder}/pick`, a.token, POST as H, { params: { id: h.holder } }, { eventId: h.eventId });
      expect(own.status, await own.clone().text()).toBe(200);
      const red = await redemptions();
      expect(red).toHaveLength(1);
      expect((await pool.query(`SELECT owner_id, status FROM tickets.tickets WHERE id=$1`, [red[0].ticket_id])).rows[0]).toEqual({ owner_id: a.id, status: 'valid' });

      const fdel = await call('DELETE', `/api/buyer/subscriptions/${h.holder}/pick/${h.eventId}`, b.token, DELETE as H, { params: { id: h.holder, eventId: h.eventId } });
      expect([403, 404]).toContain(fdel.status);
      expect(await redemptions()).toHaveLength(1);

      const odel = await call('DELETE', `/api/buyer/subscriptions/${h.holder}/pick/${h.eventId}`, a.token, DELETE as H, { params: { id: h.holder, eventId: h.eventId } });
      expect(odel.status, await odel.clone().text()).toBe(200);
      expect(await redemptions()).toHaveLength(0);
      expect((await pool.query(`SELECT status FROM tickets.tickets WHERE id=$1`, [red[0].ticket_id])).rows[0].status).toBe('revoked');
      expect(Number((await pool.query(`SELECT restwert_credit_halire c FROM subscriptions.holders WHERE id=$1`, [h.holder])).rows[0].c)).toBe(100000);
    });

    it('skupinová pozvánka: organizátor = přihlášený kupec; cizí ticket_type k akci se odmítne', async () => {
      const a = await buyer('gia');
      const c = await clone.seed.chain(); const other = await clone.seed.chain();
      const { POST } = await import('@/app/api/buyer/group-invitations/route');
      const r = await call('POST', '/api/buyer/group-invitations', a.token, POST as H, undefined, { eventId: c.eventId, ticketTypeId: c.ticketTypeId, targetSeats: 4 });
      expect(r.status, await r.clone().text()).toBe(200);
      const { invitationId } = (await r.json()) as { invitationId: string };
      expect((await pool.query(`SELECT organizer_user_id FROM orders.group_invitations WHERE id=$1`, [invitationId])).rows[0].organizer_user_id).toBe(a.id);
      const bad = await call('POST', '/api/buyer/group-invitations', a.token, POST as H, undefined, { eventId: c.eventId, ticketTypeId: other.ticketTypeId, targetSeats: 4 });
      expect([404, 422]).toContain(bad.status);
    });

    it('skupinová rezervace sedadel + claim cizím kupcem přes token: objednávka a sedadlo patří claimujícímu', async () => {
      const a = await buyer('gra'); const b = await buyer('grb');
      const c = await clone.seed.chain({ basePrice: 30000 });
      await pool.query(`UPDATE catalog.ticket_types SET is_seated=true WHERE id=$1`, [c.ticketTypeId]);
      for (const n of ['1', '2', '3']) {
        await pool.query(`INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, status) VALUES ($1,$2,'A','1',$3,'available')`, [c.eventId, c.ticketTypeId, n]);
      }
      const { POST: reserve } = await import('@/app/api/buyer/group-invitations/reserve/route');
      const r = await call('POST', '/api/buyer/group-invitations/reserve', a.token, reserve as H, undefined, { eventId: c.eventId, ticketTypeId: c.ticketTypeId, seatCount: 2 });
      expect(r.status, await r.clone().text()).toBe(200);
      const { inviteToken, seats } = (await r.json()) as { inviteToken: string; seats: Array<{ id: string }> };
      expect((await pool.query(`SELECT count(*)::int n FROM catalog.event_seats WHERE id = ANY($1::uuid[]) AND status='held' AND hold_user_id=$2`, [seats.map((s) => s.id), a.id])).rows[0].n).toBe(2);

      const { POST: claim } = await import('@/app/api/buyer/group-invitations/[token]/claim/route');
      const cr = await call('POST', `/api/buyer/group-invitations/${inviteToken}/claim`, b.token, claim as H, { params: { token: inviteToken } }, { seatId: seats[0].id });
      expect(cr.status, await cr.clone().text()).toBe(200);
      const { orderId } = (await cr.json()) as { orderId: string };
      const o = (await pool.query(`SELECT user_id, status, gopay_payment_id FROM orders.orders WHERE id=$1`, [orderId])).rows[0];
      expect(o.user_id).toBe(b.id);
      expect(o.status).toBe('pending');
      expect(o.gopay_payment_id, 'platební id z brány zapsáno (systémově, ne pod kupcem)').toMatch(/^\d+$/);
      expect((await pool.query(`SELECT order_id, status FROM catalog.event_seats WHERE id=$1`, [seats[0].id])).rows[0]).toEqual({ order_id: orderId, status: 'sold' });
    });

    it('Spotify (mock): připojení, stav a odpojení jen vlastní; doporučení jen z vlastních interpretů', async () => {
      const a = await buyer('spa'); const b = await buyer('spb');
      const { POST, GET, DELETE } = await import('@/app/api/buyer/spotify/connect/route');
      const pr = await call('POST', '/api/buyer/spotify/connect', a.token, POST as H, undefined, { mockArtists: ['Fix Kapela R3'] });
      expect(pr.status, await pr.clone().text()).toBe(200);
      const ga = (await (await call('GET', '/api/buyer/spotify/connect', a.token, GET as H)).json()) as { connected?: boolean };
      const gb = (await (await call('GET', '/api/buyer/spotify/connect', b.token, GET as H)).json()) as { connected?: boolean };
      expect(ga.connected).toBe(true);
      expect(gb.connected).toBe(false);
      const db_ = await call('DELETE', '/api/buyer/spotify/connect', b.token, DELETE as H);
      expect(db_.status).toBeLessThan(500);
      expect((await pool.query(`SELECT count(*)::int n FROM marketing.user_spotify_connections WHERE user_id=$1`, [a.id])).rows[0].n).toBe(1);

      // doporučení: akce s interpretem „Fix Kapela R3"
      const c = await clone.seed.chain();
      const art = randomUUID();
      await pool.query(`INSERT INTO lineups.artists (id, promoter_id, name, public) VALUES ($1,$2,'Fix Kapela R3',true)`, [art, c.promoterId]);
      await pool.query(`INSERT INTO lineups.event_artists (event_id, artist_id) VALUES ($1,$2)`, [c.eventId, art]);
      const { GET: discover } = await import('@/app/api/buyer/discover/events/route');
      const da = (await (await call('GET', '/api/buyer/discover/events', a.token, discover as H)).json()) as { hasConnection: boolean; events: Array<{ eventId: string }> };
      expect(da.hasConnection).toBe(true);
      expect(da.events.map((e) => e.eventId)).toContain(c.eventId);
      const dbb = (await (await call('GET', '/api/buyer/discover/events', b.token, discover as H)).json()) as { hasConnection: boolean };
      expect(dbb.hasConnection).toBe(false);

      const del = await call('DELETE', '/api/buyer/spotify/connect', a.token, DELETE as H);
      expect(del.status).toBeLessThan(300);
      expect((await pool.query(`SELECT count(*)::int n FROM marketing.user_spotify_connections WHERE user_id=$1`, [a.id])).rows[0].n).toBe(0);
    });

    it('Spotify OAuth callback (simulátor): spojení se zapíše jen uživateli ze state', async () => {
      const a = await buyer('spoa');
      const saved = { ...process.env };
      Object.assign(process.env, {
        SPOTIFY_CLIENT_ID: 'fix-sp', SPOTIFY_CLIENT_SECRET: 'fix-sp-secret',
        SPOTIFY_ACCOUNTS_BASE_URL: `${FAKE}/spotify-accounts`, SPOTIFY_API_BASE_URL: `${FAKE}/spotify-api`,
      });
      try {
        const { POST } = await import('@/app/api/buyer/spotify/connect/route');
        const pr = await call('POST', '/api/buyer/spotify/connect', a.token, POST as H, undefined, {});
        expect(pr.status, await pr.clone().text()).toBe(200);
        const { state } = (await pr.json()) as { state: string };
        const { GET: cb } = await import('@/app/api/buyer/spotify/callback/route');
        const r = await call('GET', `/api/buyer/spotify/callback?code=fixcode&state=${state}`, null, cb as H);
        expect(r.status).toBe(303);
        expect(r.headers.get('location') ?? '').not.toContain('error=');
        const row = (await pool.query(`SELECT spotify_user_id, is_mock FROM marketing.user_spotify_connections WHERE user_id=$1`, [a.id])).rows[0];
        expect(row).toEqual({ spotify_user_id: 'fix-spotify-user', is_mock: false });
        expect((await pool.query(`SELECT count(*)::int n FROM marketing.user_top_artists WHERE user_id=$1`, [a.id])).rows[0].n).toBeGreaterThan(0);
      } finally {
        for (const k of ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_ACCOUNTS_BASE_URL', 'SPOTIFY_API_BASE_URL']) {
          if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
        }
      }
    });
  });

  // ───────────────────────── 2: pořadatel proti cizímu pořadateli ─────────────────────────
  describe('2 — pořadatel', () => {
    it('charita: alokace na vlastní akci (+ claim sloty), na cizí akci ne', async () => {
      const own = await clone.seed.chain(); const foreign = await clone.seed.chain();
      const t = await promoterOf(own);
      const partner = randomUUID();
      await pool.query(`INSERT INTO charity.partners (id, name, contact_email, approved, approved_at) VALUES ($1,'Fix Charita',$2,true,now())`, [partner, `ch-${partner.slice(0, 6)}@fix.test`]);
      const { POST } = await import('@/app/api/admin/charity/allocations/route');
      const ok = await call('POST', '/api/admin/charity/allocations', t, POST as H, undefined, { charityId: partner, eventId: own.eventId, quantity: 3 });
      expect([200, 201], await ok.clone().text()).toContain(ok.status);
      expect((await pool.query(`SELECT count(*)::int n FROM charity.claim_slots s JOIN charity.allocations a ON a.id=s.allocation_id WHERE a.event_id=$1`, [own.eventId])).rows[0].n).toBe(3);
      const bad = await call('POST', '/api/admin/charity/allocations', t, POST as H, undefined, { charityId: partner, eventId: foreign.eventId, quantity: 1 });
      expect([403, 404]).toContain(bad.status);
      expect((await pool.query(`SELECT count(*)::int n FROM charity.allocations WHERE event_id=$1`, [foreign.eventId])).rows[0].n).toBe(0);
    });

    it('fotky výhledu sedadel: vlastní akce ano, cizí ne', async () => {
      const own = await clone.seed.chain(); const foreign = await clone.seed.chain();
      const t = await promoterOf(own);
      const { GET } = await import('@/app/api/admin/events/[id]/view-photos/route');
      const r1 = await call('GET', `/api/admin/events/${own.eventId}/view-photos`, t, GET as H, { params: { id: own.eventId } });
      expect(r1.status, await r1.clone().text()).toBe(200);
      const r2 = await call('GET', `/api/admin/events/${foreign.eventId}/view-photos`, t, GET as H, { params: { id: foreign.eventId } });
      expect([403, 404]).toContain(r2.status);
    });

    it('NIPOS report pořadatele → 200 (bez admin práv)', async () => {
      const fc = await clone.seed.fullChain();
      const t = await promoterOf(fc);
      const { GET } = await import('@/app/api/admin/reports/nipos/route');
      const r = await call('GET', `/api/admin/reports/nipos?year=${new Date().getFullYear()}`, t, GET as H);
      expect(r.status, await r.clone().text()).toBe(200);
    });

    it('abonentní balíček: úprava vlastního ano, cizího ne', async () => {
      const own = await clone.seed.chain(); const foreign = await clone.seed.chain();
      const t = await promoterOf(own);
      const mk = async (pid: string) => {
        const id = randomUUID();
        await pool.query(`INSERT INTO subscriptions.packages (id, promoter_id, name, slug, season_label, base_price_halire, abo_type, status) VALUES ($1,$2,'Pevné',$3,'2026/27',200000,'fixed','draft')`, [id, pid, `pkg-${id.slice(0, 8)}`]);
        return id;
      };
      const pOwn = await mk(own.promoterId); const pForeign = await mk(foreign.promoterId);
      const { PATCH } = await import('@/app/api/admin/subscriptions/packages/[id]/route');
      const r1 = await call('PATCH', `/api/admin/subscriptions/packages/${pOwn}`, t, PATCH as H, { params: { id: pOwn } }, { name: 'Přejmenováno' });
      expect(r1.status, await r1.clone().text()).toBe(200);
      expect((await pool.query(`SELECT name FROM subscriptions.packages WHERE id=$1`, [pOwn])).rows[0].name).toBe('Přejmenováno');
      const r2 = await call('PATCH', `/api/admin/subscriptions/packages/${pForeign}`, t, PATCH as H, { params: { id: pForeign } }, { name: 'Ukradeno' });
      expect([403, 404]).toContain(r2.status);
      expect((await pool.query(`SELECT name FROM subscriptions.packages WHERE id=$1`, [pForeign])).rows[0].name).toBe('Pevné');
    });
  });

  // ───────────────────────── 3: anonym + servis ─────────────────────────
  describe('3 — anonym a servisní routy bez admin eskalace', () => {
    it('veřejné fotky výhledu akce', async () => {
      const c = await clone.seed.chain();
      await pool.query(`INSERT INTO catalog.seat_view_photos (venue_id, sector_name, photo_url) VALUES ($1,'Parter','https://img.fix/p.jpg')`, [c.venueId]);
      const { GET } = await import('@/app/api/events/[id]/seat-view-photos/route');
      const r = await call('GET', `/api/events/${c.eventId}/seat-view-photos`, null, GET as H, { params: { id: c.eventId } });
      expect(r.status).toBe(200);
      expect(Object.keys(((await r.json()) as { sectorPhotos: Record<string, unknown> }).sectorPhotos)).toContain('Parter');
    });

    it('white-label: ověřená doména → pořadatel', async () => {
      const c = await clone.seed.chain();
      await pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [c.promoterId]);
      const dom = `fix-${randomUUID().slice(0, 8)}.example`;
      await pool.query(`INSERT INTO platform.promoter_domains (promoter_id, domain, verification_token, verified_at) VALUES ($1,$2,'tok',now())`, [c.promoterId, dom]);
      const { resolveWhiteLabel } = await import('@/lib/white-label/domain');
      expect((await resolveWhiteLabel(dom))?.promoterId).toBe(c.promoterId);
    });

    it('OTP: request + verify (anonymní, servisní kontext)', async () => {
      const phone = `+420${String(Date.now()).slice(-9)}`;
      const { POST: rq } = await import('@/app/api/buyer/otp/request/route');
      const r1 = await call('POST', '/api/buyer/otp/request', null, rq as H, undefined, { phone });
      expect(r1.status, await r1.clone().text()).toBe(200);
      // kód je jen hash → ověříme verify s chybným kódem: musí projít až na porovnání (ne 500 / RLS)
      const { POST: vf } = await import('@/app/api/buyer/otp/verify/route');
      const r2 = await call('POST', '/api/buyer/otp/verify', null, vf as H, undefined, { phone, code: '000000' });
      expect([400, 401, 422]).toContain(r2.status);
      expect((await pool.query(`SELECT attempts FROM marketing.otp_codes WHERE phone_e164=$1 ORDER BY created_at DESC LIMIT 1`, [phone])).rows[0].attempts).toBe(1);
    });

    it('charitativní claim: náhled + uplatnění tokenu (anonym)', async () => {
      const c = await clone.seed.chain();
      const partner = randomUUID();
      await pool.query(`INSERT INTO charity.partners (id, name, contact_email, approved) VALUES ($1,'Fix Charita 2',$2,true)`, [partner, `c2-${partner.slice(0, 6)}@fix.test`]);
      const alloc = randomUUID();
      await pool.query(`INSERT INTO charity.allocations (id, promoter_id, charity_id, event_id, ticket_type_id, quantity) VALUES ($1,$2,$3,$4,$5,1)`, [alloc, c.promoterId, partner, c.eventId, c.ticketTypeId]);
      const tok = `fixclaim${randomUUID().replace(/-/g, '')}`;
      await pool.query(`INSERT INTO charity.claim_slots (allocation_id, claim_token) VALUES ($1,$2)`, [alloc, tok]);
      const { GET, POST } = await import('@/app/api/charity/claim/[token]/route');
      const g = await call('GET', `/api/charity/claim/${tok}`, null, GET as H, { params: { token: tok } });
      expect(g.status, await g.clone().text()).toBe(200);
      const p = await call('POST', `/api/charity/claim/${tok}`, null, POST as H, { params: { token: tok } }, { email: `claim-${tok.slice(-6)}@fix.test`, name: 'Příjemce' });
      expect(p.status, await p.clone().text()).toBe(200);
      expect((await pool.query(`SELECT status FROM charity.claim_slots WHERE claim_token=$1`, [tok])).rows[0].status).not.toBe('available');
    });

    it('náhled skupinové pozvánky (anonym) + cron uvolnění propadlých držení', async () => {
      const a = await buyer('gpa');
      const c = await clone.seed.chain();
      const tok = `fixinv${randomUUID().replace(/-/g, '')}`;
      await pool.query(`INSERT INTO orders.group_invitations (organizer_user_id, event_id, target_seats, invite_token) VALUES ($1,$2,3,$3)`, [a.id, c.eventId, tok]);
      const { GET } = await import('@/app/api/group-invitations/[token]/route');
      const r = await call('GET', `/api/group-invitations/${tok}`, null, GET as H, { params: { token: tok } });
      expect(r.status, await r.clone().text()).toBe(200);
      const { POST: cron } = await import('@/app/api/internal/cron/release-group-invite-holds/route');
      const cr = await throughMiddleware(new Request('http://localhost/api/internal/cron/release-group-invite-holds', {
        method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN! } }), cron as H);
      expect(cr.status, await cr.clone().text()).toBe(200);
    });

    it('dárkový poukaz pořadatele: checkout (anonym, servisní kontext) založí poukaz', async () => {
      const c = await clone.seed.chain();
      const slug = (await pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1 RETURNING slug`, [c.promoterId])).rows[0].slug;
      const { POST } = await import('@/app/api/p/[slug]/vouchers/checkout/route');
      const email = `vch-${randomUUID().slice(0, 6)}@fix.test`;
      const r = await call('POST', `/api/p/${slug}/vouchers/checkout`, null, POST as H, { params: { slug } }, { amountKc: 500, buyerEmail: email, buyerName: 'Dárce' });
      expect(r.status, await r.clone().text()).toBeLessThan(300);
      expect((await pool.query(`SELECT count(*)::int n FROM marketing.gift_vouchers WHERE promoter_id=$1`, [c.promoterId])).rows[0].n).toBe(1);
    });
  });
});
