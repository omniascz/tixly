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
 * nedokazuje, že cesta projde.
 *
 * Test volá SKUTEČNÝ route handler, ne repliku SQL.
 * Klon i seed jdou přes `tests/helpers/live-fixture`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

import { createLiveClone, makeSeed, hasNeonKey, type LiveClone, type Seed } from './helpers/live-fixture';

describe.skipIf(!hasNeonKey)('auth/reset-password proti reálnému schématu (live)', () => {
  let clone: LiveClone;
  let pool: Pool;
  let seed: Seed;

  function req(body: unknown): NextRequest {
    return new Request('http://x/api/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest;
  }

  /** Uživatel (přes seed factory) + platný reset token. Vrací i plaintext token. */
  async function withResetToken(label: string) {
    const u = await seed.user(label, 'Reset Tester');
    const token = randomUUID();
    const tokenHash = await bcrypt.hash(token, 4);
    const t = await pool.query<{ id: string }>(
      `INSERT INTO identity.password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour') RETURNING id`,
      [u.id, tokenHash],
    );
    return { userId: u.id, tokenId: t.rows[0].id, token, email: u.email };
  }

  async function secretOf(userId: string): Promise<string | null> {
    const r = await pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM identity.user_secrets WHERE user_id = $1`,
      [userId],
    );
    return r.rows[0]?.password_hash ?? null;
  }

  beforeAll(async () => {
    clone = await createLiveClone('reset-pw');
    pool = clone.pool;
    seed = makeSeed(pool);
  }, 180_000);

  afterAll(async () => {
    await clone?.cleanup();
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
    const s = await withResetToken('ok');
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
    const s = await withResetToken('audit');

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
    const s = await withResetToken('badtoken');
    const before = await secretOf(s.userId);

    const res = await POST(req({ token: randomUUID(), newPassword: 'Nepovolené789!' }));
    expect(res.status).toBe(401);

    expect(await secretOf(s.userId)).toBe(before);
    const au = await pool.query(`SELECT 1 FROM audit.audit_log WHERE record_id = $1`, [s.userId]);
    expect(au.rows).toHaveLength(0);
  });
});
