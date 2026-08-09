/**
 * catalog-seed.ts — zalozit radek do libovolne tabulky podle KATALOGU, ne odhadu.
 *
 * Vzniklo pri mereni 93 buyer-only policies (§184). Rucne psany seed selhaval
 * pokazde jinak (CHECK vycty, ciselne meze, FK do prazdne tabulky, PK jinde nez
 * `id`) a kazde selhani vypadalo jako nalez v RLS. Tohle si vsechno precte
 * z `pg_attribute` / `pg_constraint` / `pg_index`.
 *
 * Kdyz retez dostavet nejde, vraci `{ err }` — volajici to ma hlasit jako NEVIM,
 * nikdy jako "rozbite".
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

export interface SeedResult { id?: unknown; err?: string }

export function makeInserter(q: Pool, known: Record<string, unknown>) {
  const pkCache = new Map<string, string>();

  const pkCol = async (tbl: string) => {
    if (pkCache.has(tbl)) return pkCache.get(tbl)!;
    const r = await q.query<{ c: string }>(
      `SELECT a.attname AS c FROM pg_index i
         JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid=$1::regclass AND i.indisprimary`, [tbl]);
    const c = r.rows.length === 1 ? r.rows[0].c : 'ctid';
    pkCache.set(tbl, c);
    return c;
  };

  /** CHECK (col = ANY (ARRAY['a','b'])) -> 'a';  CHECK (col >= 2) -> 2 */
  const checkValues = async (tbl: string) => {
    const r = await q.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid=$1::regclass AND contype='c'`, [tbl]);
    const out = new Map<string, string | number>();
    for (const row of r.rows) {
      const m = /\(?([a-z_]+)\)?\s*=\s*ANY\s*\(ARRAY\[(.+?)\]\)/is.exec(row.def);
      if (m) {
        const first = /'([^']*)'/.exec(m[2]);
        if (first) out.set(m[1], first[1]);
        continue;
      }
      const n = /\(?([a-z_]+)\)?\s*>=\s*(\d+)/.exec(row.def);
      // `>= 0` nestaci: vedle byva `> 0`. Minimum posouvame na 1.
      if (n) out.set(n[1], Math.max(Number(n[2]), 1));
    }
    return out;
  };

  const fkTargets = async (tbl: string) => {
    const r = await q.query<{ col: string; tgt: string }>(
      `SELECT a.attname AS col, c.confrelid::regclass::text AS tgt
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
        WHERE c.conrelid=$1::regclass AND c.contype='f' AND array_length(c.conkey,1)=1`, [tbl]);
    return new Map(r.rows.map((x) => [x.col, x.tgt]));
  };

  const insert = async (
    tbl: string, corr: string | null, val: unknown, depth = 0,
  ): Promise<SeedResult> => {
    const meta = await q.query<{ attname: string; typ: string; notnull: boolean; hasdef: boolean }>(
      `SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS typ, a.attnotnull AS notnull,
              (d.adrelid IS NOT NULL) AS hasdef
         FROM pg_attribute a
         LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped`, [tbl]);
    const checks = await checkValues(tbl);
    const fks = await fkTargets(tbl);
    const cols: string[] = []; const vals: unknown[] = [];

    for (const c of meta.rows.filter((x) => x.notnull && !x.hasdef)) {
      if (corr && c.attname === corr) { cols.push(corr); vals.push(val); continue; }
      if (known[c.attname] !== undefined) { cols.push(c.attname); vals.push(known[c.attname]); continue; }
      if (checks.has(c.attname)) { cols.push(c.attname); vals.push(checks.get(c.attname)); continue; }
      const tgt = fks.get(c.attname);
      if (tgt) {
        const pk = await pkCol(tgt);
        let ex = await q.query(`SELECT ${pk} AS id FROM ${tgt} LIMIT 1`);
        if (!ex.rowCount && depth < 1) {
          const made = await insert(tgt, null, null, depth + 1);
          if (made.err) return { err: `FK ${c.attname}->${tgt}: ${made.err}` };
          ex = await q.query(`SELECT ${pk} AS id FROM ${tgt} LIMIT 1`);
        }
        if (!ex.rowCount) return { err: `FK ${c.attname}->${tgt} prazdna` };
        cols.push(c.attname); vals.push(ex.rows[0].id); continue;
      }
      if (c.typ === 'uuid') return { err: `neresitelny uuid: ${c.attname}` };
      if (/int|numeric|bigint|double|real/.test(c.typ)) vals.push(1);
      else if (/timestamp|date/.test(c.typ)) vals.push(new Date().toISOString());
      else if (c.typ === 'boolean') vals.push(false);
      else if (/jsonb?/.test(c.typ)) vals.push('{}');
      else if (/\[\]$/.test(c.typ)) vals.push('{}');
      else if (/text|character|citext/.test(c.typ)) vals.push(`x${randomUUID().slice(0, 8)}`);
      else if (/bytea/.test(c.typ)) vals.push(Buffer.from('x'));
      else return { err: `neznamy typ ${c.typ} (${c.attname})` };
      cols.push(c.attname);
    }
    if (corr && !cols.includes(corr) && meta.rows.some((c) => c.attname === corr)) {
      cols.push(corr); vals.push(val);
    }
    const pk = await pkCol(tbl);
    try {
      const r = await q.query(
        `INSERT INTO ${tbl} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING ${pk}`,
        vals);
      return { id: r.rows[0][pk] };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      // Korelacni sloupec byva zaroven PK (user_secrets: PK = user_id) a radek uz
      // muze existovat. To neni chyba seedu — pouzij ten existujici.
      if (err.code === '23505' && corr === pk) {
        const ex = await q.query(`SELECT ${pk} AS id FROM ${tbl} WHERE ${pk}=$1`, [val]);
        if (ex.rowCount) return { id: ex.rows[0].id };
      }
      return { err: `${err.code} ${err.message?.slice(0, 70)}` };
    }
  };
  return { insert, pkCol };
}

/**
 * Precte pod danym GUC kontextem, jestli je radek videt.
 *
 * VZDY `SET LOCAL` v transakci (R-54): holy `SET` prezije spojeni a na poolovanem
 * endpointu se dostane k dalsimu mereni. Zaroven se tim uklidi GUC, ktere tenhle
 * kontext nenastavuje — jinak by kontext dedil zbytky predchoziho.
 */
export async function seesRow(
  uri: string, tbl: string, pk: string, id: unknown, gucs: Record<string, string>,
): Promise<number> {
  const { Client } = await import('pg');
  const c = new Client({ connectionString: uri });
  await c.connect();
  try {
    await c.query('BEGIN');
    for (const [k, v] of Object.entries(gucs)) await c.query(`SET LOCAL ${k} = '${v}'`);
    const r = await c.query(`SELECT count(*)::int n FROM ${tbl} WHERE ${pk}=$1`, [id]);
    await c.query('COMMIT');
    return r.rows[0].n as number;
  } finally {
    await c.end();
  }
}
