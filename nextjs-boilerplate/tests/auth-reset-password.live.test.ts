// @vitest-environment node
/**
 * Runtime test cesty `POST /api/auth/reset-password` proti REÁLNÉMU schématu.
 *
 * Proč live a ne unit: oba blockery, které tu cestu shazovaly, jsou zjistitelné
 * VÝHRADNĚ proti skutečnému schématu.
 *   - `42P08` vzniklo tím, že `record_id` je `text` a `actor_id` je `uuid`.
 *     Unit test nad textem SQL tenhle rozdíl typů nemůže znát.
 *   - `23514` závisí na obsahu `audit_log_actor_type_check`.
 * Aserce nad řetězcem SQL by byla tautologie („SQL obsahuje 'user'"), která
 * nedokazuje, že cesta projde. Proto sem, do live dráhy, kde už je zavedený
 * lifecycle ephemeral klonu.
 *
 * Test volá SKUTEČNÝ route handler, ne repliku SQL — replika by mohla
 * divergovat od routy přesně v tom, co se testuje.
 *
 * Bez `NEON_API_KEY` se přeskočí.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const NEON_API = 'https://console.neon.tech/api/v2';
const PROJECT = 'fragrant-wildflower-75132205';
const PARENT_BRANCH = 'br-rough-paper-alom0zky';
const DB_NAME = 'neondb';
const ROLE = 'neondb_owner';

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

describe.skipIf(!apiKey)('auth/reset-password proti reálnému schématu (live)', () => {
  let branchId: string | null = null;
  let pool: Pool;

  const run = `${Date.now()}`;

  function req(body: unknown): NextRequest {
    return new Request('http://x/api/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest;
  }

  /** Založí uživatele s platným reset tokenem. Vrací i plaintext token. */
  async function seedUserWithToken(label: string) {
    const email = `reset-${label}-${run}@tixly.test`;
    const u = await pool.query<{ id: string }>(
      `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at)
       VALUES ($1, 'Reset Tester', '!guest', NOW()) RETURNING id`,
      [email],
    );
    const userId = u.rows[0].id;
    const token = randomUUID();
    const tokenHash = await bcrypt.hash(token, 4);
    const t = await pool.query<{ id: string }>(
      `INSERT INTO identity.password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour') RETURNING id`,
      [userId, tokenHash],
    );
    return { userId, tokenId: t.rows[0].id, token, email };
  }

  async function secretOf(userId: string): Promise<string | null> {
    const r = await pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM identity.user_secrets WHERE user_id = $1`,
      [userId],
    );
    return r.rows[0]?.password_hash ?? null;
  }

  beforeAll(async () => {
    const created = await neon(`/projects/${PROJECT}/branches`, {
      method: 'POST',
      body: JSON.stringify({
        branch: { parent_id: PARENT_BRANCH, name: `reset-pw-${run}` },
        endpoints: [{ type: 'read_write' }],
      }),
    });
    branchId = created.branch.id;
    await new Promise((r) => setTimeout(r, 4000));
    const { uri } = await neon(
      `/projects/${PROJECT}/connection_uri?branch_id=${branchId}&role_name=${ROLE}&database_name=${DB_NAME}`,
    );
    process.env.DATABASE_URL = uri;
    pool = new Pool({ connectionString: uri, max: 4 });
  }, 180_000);

  afterAll(async () => {
    if (pool) await pool.end().catch(() => undefined);
    // Líný pool z rls-pool musí zmizet PŘED smazáním větve, jinak
    // `Connection terminated unexpectedly` → unhandled error → exit 1.
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

  it('audit_log CHECK a typy sloupců jsou pořád takové, jak fix předpokládá', async () => {
    // Kdyby někdo CHECK rozšířil nebo změnil typ, fix v routě je zbytečný nebo
    // špatný — test to musí říct nahlas, ne tiše zezelenat.
    const ck = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'audit.audit_log'::regclass AND conname = 'audit_log_actor_type_check'`,
    );
    expect(ck.rows).toHaveLength(1);
    expect(ck.rows[0].def).toContain("'user'");
    expect(ck.rows[0].def).not.toContain("'self'");

    const types = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='audit' AND table_name='audit_log'
          AND column_name IN ('record_id','actor_id')`,
    );
    const byName = Object.fromEntries(types.rows.map((r) => [r.column_name, r.data_type]));
    // Právě tenhle rozdíl typů způsoboval 42P08 při sdíleném `$1`.
    expect(byName.record_id).toBe('text');
    expect(byName.actor_id).toBe('uuid');
  });

  it('reset hesla DOBĚHNE a heslo se REÁLNĚ změní', async () => {
    const { POST } = await import('@/app/api/auth/reset-password/route');
    const s = await seedUserWithToken('ok');
    const before = await secretOf(s.userId);

    const res = await POST(req({ token: s.token, newPassword: 'NovéHeslo123!' }));
    expect(res.status).toBe(200);

    // Nestačí 200 — ověřujeme ZAPSANÝ stav.
    const after = await secretOf(s.userId);
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    // Trigger trg_move_password přesouvá hash do user_secrets; nové heslo proti
    // němu musí projít bcryptem.
    expect(await bcrypt.compare('NovéHeslo123!', after!)).toBe(true);

    const tok = await pool.query<{ used_at: string | null }>(
      `SELECT used_at FROM identity.password_reset_tokens WHERE id = $1`,
      [s.tokenId],
    );
    expect(tok.rows[0].used_at).not.toBeNull();
  });

  it('audit řádek se zapíše s actor_type=user a actor_id = vlastní id', async () => {
    const { POST } = await import('@/app/api/auth/reset-password/route');
    const s = await seedUserWithToken('audit');

    const res = await POST(req({ token: s.token, newPassword: 'JinéHeslo456!' }));
    expect(res.status).toBe(200);

    const au = await pool.query<{
      actor_type: string;
      actor_id: string;
      record_id: string;
      action: string;
      new_values: { event: string };
    }>(
      `SELECT actor_type, actor_id, record_id, action, new_values
         FROM audit.audit_log WHERE record_id = $1`,
      [s.userId],
    );
    expect(au.rows).toHaveLength(1);
    expect(au.rows[0].actor_type).toBe('user');
    expect(au.rows[0].action).toBe('UPDATE');
    // Důkaz, že se hodnoty neprohodily mezi record_id (text) a actor_id (uuid).
    expect(au.rows[0].actor_id).toBe(s.userId);
    expect(au.rows[0].record_id).toBe(s.userId);
    expect(au.rows[0].new_values.event).toBe('password_reset');
  });

  it('neplatný token nic nezmění (fix neotevřel cestu bez tokenu)', async () => {
    const { POST } = await import('@/app/api/auth/reset-password/route');
    const s = await seedUserWithToken('badtoken');
    const before = await secretOf(s.userId);

    const res = await POST(req({ token: randomUUID(), newPassword: 'Nepovolené789!' }));
    expect(res.status).toBe(401);

    expect(await secretOf(s.userId)).toBe(before);
    const au = await pool.query(`SELECT 1 FROM audit.audit_log WHERE record_id = $1`, [s.userId]);
    expect(au.rows).toHaveLength(0);
  });
});
