// @vitest-environment node
/**
 * V1 — reset hesla vracel 500 („column locale does not exist" v forgot-password).
 * Regresní test celého toku proti IZOLOVANÉ DB (bez Neonu, bez mocků):
 *   forgot-password → e-mail v Mailpitu → reset-password → login novým heslem →
 *   staré heslo nefunguje → token nejde použít podruhé.
 *
 * Běží jen s FIX_E2E=1 (jinak se přeskočí, ať nezdržuje běžnou sadu).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, mailpitLatest, type LocalClone } from './helpers/local-fixture';

const run = describe.skipIf(!hasLocalDb);

function post(path: string, body: unknown, ip: string): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'x-real-ip': ip },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

run('V1 reset hesla — celý tok (izolovaná DB)', () => {
  let clone: LocalClone;
  let pool: Pool;
  let forgotPOST: (req: NextRequest) => Promise<Response>;
  let resetPOST: (req: NextRequest) => Promise<Response>;
  let loginPOST: (req: NextRequest) => Promise<Response>;

  const email = `v1-${randomUUID().slice(0, 8)}@tixly.test`;
  const oldPw = 'OldPass123';
  const newPw = 'NewPass456';
  const ipBase = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
    const reg = await import('@/app/api/auth/register/route');
    forgotPOST = (await import('@/app/api/auth/forgot-password/route')).POST;
    resetPOST = (await import('@/app/api/auth/reset-password/route')).POST;
    loginPOST = (await import('@/app/api/auth/login/route')).POST;
    // uživatel se známým heslem přes REÁLNÝ register handler
    const r = await reg.POST(post('/api/auth/register', { email, password: oldPw, name: 'V1 User' }, ipBase + '0'));
    if (r.status !== 200) throw new Error(`register ${r.status} ${await r.text()}`);
  }, 120_000);

  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  it('forgot-password NEVRACÍ 500 a doručí e-mail s reset odkazem', async () => {
    const r = await forgotPOST(post('/api/auth/forgot-password', { email }, ipBase + '1'));
    // PŘED opravou: 500 (column "locale" does not exist). PO opravě: 200 + e-mail.
    expect(r.status).toBe(200);
    const mail = await (async () => {
      for (let i = 0; i < 20; i++) { const m = await mailpitLatest(email); if (m) return m; await new Promise((x) => setTimeout(x, 500)); }
      return null;
    })();
    expect(mail, 'e-mail s resetem má dorazit do Mailpitu').not.toBeNull();
    expect(mail!.html).toContain('reset-password?token=');
  });

  it('reset novým heslem projde, nové heslo funguje, staré ne, token je jednorázový', async () => {
    const mail = await mailpitLatest(email);
    const token = decodeURIComponent(/reset-password\?token=([^"&]+)/.exec(mail!.html)![1]);

    const reset = await resetPOST(post('/api/auth/reset-password', { token, newPassword: newPw }, ipBase + '2'));
    expect(reset.status, await reset.text()).toBe(200);

    const loginNew = await loginPOST(post('/api/auth/login', { email, password: newPw }, ipBase + '3'));
    expect(loginNew.status, 'login novým heslem').toBe(200);

    const loginOld = await loginPOST(post('/api/auth/login', { email, password: oldPw }, ipBase + '4'));
    expect(loginOld.status, 'staré heslo musí selhat').toBe(401);

    const reuse = await resetPOST(post('/api/auth/reset-password', { token, newPassword: 'ThirdPass789' }, ipBase + '5'));
    expect(reuse.status, 'token nejde použít podruhé').toBe(401);

    // ground truth: hash v user_secrets se reálně změnil na nový
    const sec = await pool.query<{ ph: string }>(
      `SELECT s.password_hash AS ph FROM identity.user_secrets s
        JOIN identity.users u ON u.id = s.user_id WHERE LOWER(u.email)=LOWER($1)`, [email]);
    const bcrypt = (await import('bcryptjs')).default;
    expect(await bcrypt.compare(newPw, sec.rows[0].ph)).toBe(true);
    expect(await bcrypt.compare(oldPw, sec.rows[0].ph)).toBe(false);
  });
});
