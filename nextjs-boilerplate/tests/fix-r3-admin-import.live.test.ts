// @vitest-environment node
/**
 * Kolo 3 / krok 5 — admin/import (CSV kontaktů pořadatele) pod tixly_app.
 *
 * Kolo 2 tuto routu pod tixly_app neověřilo. Riziková místa: `INSERT … ON CONFLICT (email) DO UPDATE
 * … RETURNING` do identity.users v kontextu pořadatele (UPDATE cizího uživatele + RETURNING
 * nevyhovuje SELECT politice pořadatele) a upsert promoter_contacts s `RETURNING (xmax = 0)`.
 *
 * Očekávání: import projde bez role vlastníka; nový e-mail i e-mail existujícího uživatele platformy
 * se naváže jako kontakt pořadatele; import NESMÍ přepsat jméno existujícího uživatele (globální
 * identita není pořadatelova); opakovaný import kontakty aktualizuje (skippedRows), ne zdvojí.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest) => Promise<Response>;

run('Krok 5 (kolo 3) — admin/import pod tixly_app', () => {
  let clone: LocalClone;
  let pool: Pool;
  let c: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  let token: string;
  let existing: { id: string; email: string };
  const fresh = `import-${randomUUID().slice(0, 8)}@fix.test`;

  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
    c = await clone.seed.chain();
    await pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [c.promoterId]);
    existing = await clone.seed.user('importexisting', 'Skutečné Jméno');
    const email = (await pool.query(`SELECT email FROM identity.users WHERE id=$1`, [c.adminUserId])).rows[0].email;
    const { signAccessToken } = await import('@/lib/auth');
    token = await signAccessToken({ id: c.adminUserId, email, name: 'Pořadatel' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: c.promoterId, status: 'active', role: 'owner' } as never] });
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const importCsv = async (csv: string) => {
    const fd = new FormData();
    fd.set('file', new File([csv], 'kontakty.csv', { type: 'text/csv' }));
    fd.set('source', 'csv');
    fd.set('columnMapping', JSON.stringify({ email: 'email', name: 'jmeno', phone: 'telefon', purchases: 'nakupy' }));
    const { POST } = await import('@/app/api/admin/import/route');
    return throughMiddleware(new Request('http://localhost/api/admin/import', {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd }), POST as H);
  };
  const csv = () => `email;jmeno;telefon;nakupy\n${fresh};Nový Kontakt;+420600000001;3\n${existing.email};Přepsané Jméno;+420600000002;7\nneplatny-email;X;;\n`;

  it('první import: 2 kontakty založeny, 1 chybný řádek; existující uživatel nepřejmenován', async () => {
    const r = await importCsv(csv());
    expect(r.status, await r.clone().text()).toBe(200);
    const j = (await r.json()) as { importedUsers: number; skippedRows: number; errorRows: number; jobId: string };
    expect({ importedUsers: j.importedUsers, skippedRows: j.skippedRows, errorRows: j.errorRows }).toEqual({ importedUsers: 2, skippedRows: 0, errorRows: 1 });

    const contacts = (await pool.query(`SELECT email, name, historical_purchases, user_id FROM platform.promoter_contacts WHERE promoter_id=$1 ORDER BY email`, [c.promoterId])).rows;
    expect(contacts.map((x) => x.email).sort()).toEqual([existing.email, fresh].sort());
    expect(contacts.find((x) => x.email === existing.email)!.user_id).toBe(existing.id);
    expect((await pool.query(`SELECT name FROM identity.users WHERE id=$1`, [existing.id])).rows[0].name).toBe('Skutečné Jméno');
    const newUser = (await pool.query(`SELECT u.name, s.password_hash FROM identity.users u LEFT JOIN identity.user_secrets s ON s.user_id = u.id WHERE lower(u.email)=lower($1)`, [fresh])).rows[0];
    expect(newUser.name).toBe('Nový Kontakt');
    // heslo trigger přesouvá do identity.user_secrets; placeholder bez použitelného hesla ('!')
    expect(String(newUser.password_hash).startsWith('!')).toBe(true);
    expect((await pool.query(`SELECT status, imported_users FROM platform.import_jobs WHERE id=$1`, [j.jobId])).rows[0]).toEqual({ status: 'completed', imported_users: 2 });
  });

  it('opakovaný import: kontakty se aktualizují (skippedRows 2), nezdvojí', async () => {
    const r = await importCsv(csv().replace(';3\n', ';9\n'));
    expect(r.status, await r.clone().text()).toBe(200);
    const j = (await r.json()) as { importedUsers: number; skippedRows: number };
    expect({ importedUsers: j.importedUsers, skippedRows: j.skippedRows }).toEqual({ importedUsers: 0, skippedRows: 2 });
    const rows = (await pool.query(`SELECT historical_purchases FROM platform.promoter_contacts WHERE promoter_id=$1 AND email=$2`, [c.promoterId, fresh])).rows;
    expect(rows).toEqual([{ historical_purchases: 9 }]);
  });
});
