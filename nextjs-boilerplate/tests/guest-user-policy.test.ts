/**
 * Unit test politik `createOrGetGuestUser` — DŮKAZ ZACHOVÁNÍ CHOVÁNÍ.
 *
 * Účel: refactor 7 guest-create lokací na sdílený helper nesmí změnit, co se
 * stane s UŽ EXISTUJÍCÍM účtem. Tři lokace měly odlišnou `ON CONFLICT` akci než
 * ostatní (box-office přepisoval jméno, comps ho doplňoval, guestlist psal jiný
 * password sentinel), takže helper musí umět všechny tři politiky a každá
 * call-site musí dostat tu svou.
 *
 * Proč unit a ne live: tady se netestuje, že Postgres upsert funguje (to dělá
 * `tests/guest-user.live.test.ts` proti reálnému schématu) — testuje se, že
 * helper složí SPRÁVNOU `DO UPDATE` klauzuli pro danou politiku. To je čistě
 * textová vlastnost a nepotřebuje DB, takže může běžet v CI bez klíče.
 */
import { describe, expect, it } from 'vitest';

import {
  createOrGetGuestUser,
  GUEST_PASSWORD_HASH,
  type OnExistingPolicy,
  type Queryable,
} from '@/lib/identity/guest-user';

/** Zachytí SQL + parametry, které helper poslal, a vrátí věrohodné `RETURNING id`. */
function spyClient(): { client: Queryable; sql: () => string; params: () => unknown[] } {
  let capturedSql = '';
  let capturedParams: unknown[] = [];
  const client: Queryable = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: async (text: string, params?: unknown[]): Promise<any> => {
      capturedSql = text;
      capturedParams = params ?? [];
      return { rows: [{ id: 'cafe0000-0000-4000-a000-000000000001' }] };
    },
  };
  return { client, sql: () => capturedSql, params: () => capturedParams };
}

/** Vytáhne z SQL to, co následuje za `DO UPDATE`, zploštěné na jednu mezeru. */
function conflictClause(sql: string): string {
  const m = sql.match(/DO UPDATE([\s\S]*?)RETURNING/);
  if (!m) throw new Error(`v SQL není DO UPDATE ... RETURNING:\n${sql}`);
  return m[1].replace(/\s+/g, ' ').trim();
}

describe('createOrGetGuestUser — politiky pro existující účet', () => {
  it('default je touch — existující účet se nesahá (checkout, accreditation, press, guestlist, waitlist)', async () => {
    const s = spyClient();
    await createOrGetGuestUser(s.client, { email: 'a@b.cz', name: 'A' });
    expect(conflictClause(s.sql())).toBe('SET updated_at = NOW()');
  });

  it('touch odpovídá původnímu SQL 5 lokací', async () => {
    const s = spyClient();
    await createOrGetGuestUser(s.client, { email: 'a@b.cz', name: 'A', onExisting: 'touch' });
    expect(conflictClause(s.sql())).toBe('SET updated_at = NOW()');
  });

  it('overwriteName přepíše jméno a NEnastaví updated_at (box-office/sell)', async () => {
    const s = spyClient();
    await createOrGetGuestUser(s.client, {
      email: 'a@b.cz',
      name: 'Pokladní prodej',
      onExisting: 'overwriteName',
    });
    const clause = conflictClause(s.sql());
    expect(clause).toBe('SET name = EXCLUDED.name');
    // Původní box-office SQL updated_at nenastavovalo — nesmí se přidat.
    expect(clause).not.toContain('updated_at');
  });

  it('fillName doplní jméno jen když existující je NULL (comps)', async () => {
    const s = spyClient();
    await createOrGetGuestUser(s.client, {
      email: 'a@b.cz',
      name: 'Comp Recipient',
      onExisting: 'fillName',
    });
    expect(conflictClause(s.sql())).toBe(
      'SET name = COALESCE(EXCLUDED.name, identity.users.name), updated_at = NOW()',
    );
  });

  it('žádná politika nesmí propašovat do SQL nic mimo tři známé klauzule', async () => {
    const policies: OnExistingPolicy[] = ['touch', 'overwriteName', 'fillName'];
    const seen: string[] = [];
    for (const p of policies) {
      const s = spyClient();
      await createOrGetGuestUser(s.client, { email: 'a@b.cz', name: 'A', onExisting: p });
      seen.push(conflictClause(s.sql()));
    }
    expect(seen).toEqual([
      'SET updated_at = NOW()',
      'SET name = EXCLUDED.name',
      'SET name = COALESCE(EXCLUDED.name, identity.users.name), updated_at = NOW()',
    ]);
  });
});

describe('createOrGetGuestUser — invarianty společné všem politikám', () => {
  it('drží partial ON CONFLICT predikát (bez něj 42P10) a nikdy nepoužije DO NOTHING', async () => {
    const s = spyClient();
    await createOrGetGuestUser(s.client, { email: 'a@b.cz', name: 'A' });
    expect(s.sql()).toContain('ON CONFLICT (email) WHERE anonymized_at IS NULL');
    expect(s.sql()).not.toContain('DO NOTHING');
  });

  it('dodává gdpr_consent_at (NOT NULL bez defaultu → jinak 23502)', async () => {
    const s = spyClient();
    await createOrGetGuestUser(s.client, { email: 'a@b.cz', name: 'A' });
    expect(s.sql()).toContain('gdpr_consent_at');
  });

  it('normalizuje e-mail na trim+lowercase a posílá sentinel !guest', async () => {
    const s = spyClient();
    await createOrGetGuestUser(s.client, { email: '  MiXeD@Case.CZ  ', name: 'A' });
    expect(s.params()[0]).toBe('mixed@case.cz');
    expect(s.params()[2]).toBe(GUEST_PASSWORD_HASH);
    expect(GUEST_PASSWORD_HASH).toBe('!guest');
  });

  it('při chybějícím jméně uloží e-mail jako placeholder (vzor původního waitlistu `entry.name ?? entry.email`)', async () => {
    for (const name of [undefined, null, '', '   ']) {
      const s = spyClient();
      await createOrGetGuestUser(s.client, { email: 'a@b.cz', name });
      expect(s.params()[1]).toBe('a@b.cz');
    }
  });

  it('prázdný e-mail odmítne, než se sáhne na DB', async () => {
    let called = false;
    const client: Queryable = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: async (): Promise<any> => {
        called = true;
        return { rows: [] };
      },
    };
    await expect(createOrGetGuestUser(client, { email: '   ' })).rejects.toThrow(/email je povinný/);
    expect(called).toBe(false);
  });

  it('když upsert nevrátí řádek, hodí výjimku místo undefined (pojistka proti DO NOTHING regresi)', async () => {
    const client: Queryable = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: async (): Promise<any> => ({ rows: [] }),
    };
    await expect(createOrGetGuestUser(client, { email: 'a@b.cz' })).rejects.toThrow(
      /nevrátil řádek/,
    );
  });
});
