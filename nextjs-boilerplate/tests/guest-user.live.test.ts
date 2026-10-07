// @vitest-environment node
/**
 * Runtime test sdíleného guest-create helperu proti REÁLNÉ databázi.
 *
 * Proč runtime a ne unit: schema-drift-guard je parse-only, tedy slepý na
 * NOT NULL, ON CONFLICT arbiter a CHECK. „Guard zelený" o téhle třídě chyb
 * nevypovídá nic — jediný důkaz je skutečný běh proti skutečnému schématu.
 *
 * Test si zakládá vlastní ephemeral Neon větev z produkční (tedy proti
 * skutečnému prod schématu) a na konci ji maže. Bez `NEON_API_KEY` (kolo 14 / krok 4)
 * běží proti lokální DB postavené z migrací (FIX_E2E=1, CI job Live); bez obojího
 * se blok přeskočí.
 *
 * Spuštění:
 *   NEON_API_KEY=... npx vitest run -c vitest.live.config.ts tests/guest-user.live.test.ts
 *   FIX_E2E=1 FIX_DB_OWNER_URL=... FIX_DB_APP_URL=... npx vitest run -c vitest.live.config.ts tests/guest-user.live.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createOrGetGuestUser, GUEST_PASSWORD_HASH } from '@/lib/identity/guest-user';
import { createLiveClone, hasLiveDb, type LiveClone } from './helpers/live-fixture';




describe.skipIf(!hasLiveDb)('createOrGetGuestUser (live, ephemeral Neon branch)', () => {
  let clone: LiveClone | undefined;
  let pool: Pool;
  /** Unikátní suffix, aby se testy nemíchaly mezi sebou ani mezi běhy. */
  const run = `${Date.now()}`;
  const mail = (label: string) => `gu-${label}-${run}@tixly.test`;

  beforeAll(async () => {
    // Kolo 14 / krok 4: sdílená dráha — Neon klon, nebo bez NEON_API_KEY lokální DB z migrací (FIX_E2E=1)
    clone = await createLiveClone('guest-user');
    pool = clone.pool;
    // Sanity: opravdu jsme na schématu, které testujeme.
    const probe = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='identity' AND table_name='users' AND column_name='gdpr_consent_at'`,
    );
    expect(probe.rows.length).toBe(1);
  }, 120_000);

  afterAll(async () => {
    await clone?.cleanup();
  }, 60_000);

  it('nový e-mail — založí uživatele a vrátí jeho id', async () => {
    const email = mail('new');
    const id = await createOrGetGuestUser(pool, { email, name: 'Jan Host' });

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const row = await pool.query(
      `SELECT email, name, password_hash, gdpr_consent_at, anonymized_at
         FROM identity.users WHERE id = $1`,
      [id],
    );
    expect(row.rows[0].email).toBe(email);
    expect(row.rows[0].name).toBe('Jan Host');
    // NOT NULL bez defaultu — přesně ten blocker, na který je guard slepý.
    expect(row.rows[0].gdpr_consent_at).not.toBeNull();

    // POZOR na skrytý mechanismus: trigger `trg_move_password` po INSERTu
    // přesune hash do `identity.user_secrets` a v `users` ho vynuluje.
    // Sentinel tedy NIKDY nezůstane v `users.password_hash`.
    expect(row.rows[0].password_hash).toBeNull();
    const secret = await pool.query(
      `SELECT password_hash FROM identity.user_secrets WHERE user_id = $1`,
      [id],
    );
    expect(secret.rows[0].password_hash).toBe(GUEST_PASSWORD_HASH);
  });

  it('nepřepíše heslo skutečně registrovaného účtu se stejným e-mailem', async () => {
    const email = mail('realacct');
    // Simuluj registrovaného uživatele s opravdovým bcrypt hashem.
    const realHash = '$2b$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQ';
    const reg = await pool.query<{ id: string }>(
      `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at)
       VALUES ($1, 'Registrovaný', $2, NOW()) RETURNING id`,
      [email, realHash],
    );
    const regId = reg.rows[0].id;

    const id = await createOrGetGuestUser(pool, { email, name: 'Podvržený Host' });
    expect(id).toBe(regId); // dedup na existující účet

    // Klíčová bezpečnostní vlastnost: guest-create nesmí přepsat cizí heslo
    // sentinelem, jinak by jakýkoli guest nákup odhlásil vlastníka účtu.
    const secret = await pool.query(
      `SELECT password_hash FROM identity.user_secrets WHERE user_id = $1`,
      [regId],
    );
    expect(secret.rows[0].password_hash).toBe(realHash);
  });

  it('týž e-mail podruhé — dedup: totéž id, žádný druhý řádek', async () => {
    const email = mail('dedup');
    const first = await createOrGetGuestUser(pool, { email, name: 'První' });
    const second = await createOrGetGuestUser(pool, { email, name: 'Druhý' });

    expect(second).toBe(first);
    const count = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM identity.users WHERE email = $1`,
      [email],
    );
    expect(count.rows[0].n).toBe('1');
  });

  it('nepřepíše jméno existujícího účtu', async () => {
    const email = mail('nameguard');
    const id = await createOrGetGuestUser(pool, { email, name: 'Původní Jméno' });
    await createOrGetGuestUser(pool, { email, name: 'Podvržené Jméno' });

    const row = await pool.query(`SELECT name FROM identity.users WHERE id = $1`, [id]);
    expect(row.rows[0].name).toBe('Původní Jméno');
  });

  it('normalizuje e-mail (trim + lowercase) — nevznikne duplicita z velkých písmen', async () => {
    const email = mail('norm');
    const first = await createOrGetGuestUser(pool, { email, name: 'A' });
    const second = await createOrGetGuestUser(pool, {
      email: `  ${email.toUpperCase()}  `,
      name: 'B',
    });

    expect(second).toBe(first);
    const count = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM identity.users WHERE LOWER(email) = $1`,
      [email],
    );
    expect(count.rows[0].n).toBe('1');
  });

  it('bez jména uloží jako placeholder e-mail', async () => {
    const email = mail('noname');
    const id = await createOrGetGuestUser(pool, { email });
    const row = await pool.query(`SELECT name FROM identity.users WHERE id = $1`, [id]);
    expect(row.rows[0].name).toBe(email);
  });

  it('prázdný e-mail odmítne', async () => {
    await expect(createOrGetGuestUser(pool, { email: '   ' })).rejects.toThrow(/email/i);
  });

  it('anonymizovaný účet (GDPR) se stejným e-mailem se nevzkřísí — vznikne nový aktivní', async () => {
    const email = mail('anon');
    const anon = await pool.query<{ id: string }>(
      `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, anonymized_at)
       VALUES ($1, 'Anonymized', '!deleted', NOW(), NOW())
       RETURNING id`,
      [email],
    );
    const anonId = anon.rows[0].id;

    const freshId = await createOrGetGuestUser(pool, { email, name: 'Nový Host' });

    // Partial index anonymizovaný řádek nevidí → nesmí se vrátit jeho id.
    expect(freshId).not.toBe(anonId);
    const rows = await pool.query(
      `SELECT id, anonymized_at FROM identity.users WHERE email = $1 ORDER BY anonymized_at NULLS FIRST`,
      [email],
    );
    // Dva řádky se stejným e-mailem jsou legální — partial unique to dovoluje.
    expect(rows.rows.length).toBe(2);
    const anonRow = rows.rows.find((r) => r.id === anonId);
    expect(anonRow.anonymized_at).not.toBeNull(); // anonymizovaný zůstal nedotčený
  });

  it('uvnitř transakce + ROLLBACK — guest user nezůstane viset', async () => {
    const email = mail('rollback');
    const client = await pool.connect();
    let idInTx: string;
    try {
      await client.query('BEGIN');
      idInTx = await createOrGetGuestUser(client, { email, name: 'Zrušený' });
      // Uvnitř transakce už existuje.
      const inside = await client.query(`SELECT id FROM identity.users WHERE id = $1`, [idInTx]);
      expect(inside.rows.length).toBe(1);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const after = await pool.query(`SELECT id FROM identity.users WHERE email = $1`, [email]);
    expect(after.rows.length).toBe(0);
  });

  it('DŮKAZ pasti: ON CONFLICT DO NOTHING + RETURNING při konfliktu nevrátí řádek', async () => {
    const email = mail('donothing');
    await createOrGetGuestUser(pool, { email, name: 'Existující' });

    const res = await pool.query(
      `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at)
       VALUES ($1, 'Pokus', $2, NOW())
       ON CONFLICT (email) WHERE anonymized_at IS NULL DO NOTHING
       RETURNING id`,
      [email, GUEST_PASSWORD_HASH],
    );
    // Přesně proto helper používá DO UPDATE — s DO NOTHING by `rows[0].id` bylo undefined.
    expect(res.rows.length).toBe(0);
  });

  it('DŮKAZ blockerů, na které je guard slepý: chybějící gdpr → 23502, ON CONFLICT bez predikátu → 42P10', async () => {
    const email = mail('blockers');

    // 23502: gdpr_consent_at je NOT NULL bez defaultu.
    const missingGdpr = await pool
      .query(
        `INSERT INTO identity.users (email, name, password_hash)
         VALUES ($1, 'X', $2) RETURNING id`,
        [`a-${email}`, GUEST_PASSWORD_HASH],
      )
      .then(() => null)
      .catch((e) => e.code);
    expect(missingGdpr).toBe('23502');

    // 42P10: jediný unique na e-mailu je partial, bez predikátu není arbiter.
    const noPredicate = await pool
      .query(
        `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at)
         VALUES ($1, 'X', $2, NOW())
         ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [`b-${email}`, GUEST_PASSWORD_HASH],
      )
      .then(() => null)
      .catch((e) => e.code);
    expect(noPredicate).toBe('42P10');
  });

  it('měkce smazaný účet (deleted_at) — zdokumentované chování: vrátí jeho id', async () => {
    const email = mail('softdel');
    const soft = await pool.query<{ id: string }>(
      `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, deleted_at)
       VALUES ($1, 'Smazaný', '!guest', NOW(), NOW())
       RETURNING id`,
      [email],
    );

    const id = await createOrGetGuestUser(pool, { email, name: 'Znovu' });

    // Partial index filtruje jen anonymized_at, NE deleted_at → helper účet „oživí".
    // Není to bug helperu, je to vlastnost indexu; zachyceno, aby změna byla vědomá.
    expect(id).toBe(soft.rows[0].id);
  });
});
