/**
 * AUDIT náhrada za nextjs-boilerplate/tests/helpers/live-fixture.ts.
 *
 * Originál klonuje PRODUKČNÍ Neon větev (prod data) — to audit pravidla zakazují.
 * Tahle verze má STEJNÉ API, ale `createLiveClone` založí čerstvou databázi
 * v izolovaném kontejneru `audit-pg` postavenou OD NULY z migrací
 * (000_baseline + globals + 4xx), tj. to, co repo tvrdí, že schéma staví.
 *
 * Seed factory (`makeSeed`) se re-exportuje z ORIGINÁLU beze změny.
 * Handlery běží jako `tixly_app` (NOBYPASSRLS), stejně jako default originálu.
 */
import { Pool, Client } from 'pg';
import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export { makeSeed } from '../../nextjs-boilerplate/tests/helpers/live-fixture';
export type { Seed, SeededChain, SeededOrder } from '../../nextjs-boilerplate/tests/helpers/live-fixture';

const HOST = process.env.AUDIT_PG_HOST ?? 'localhost';
const PORT = process.env.AUDIT_PG_PORT ?? '55432';
const OWNER = `postgresql://neondb_owner:auditowner@${HOST}:${PORT}`;
const MIG_DIR = join('..', 'migrations');

function discoverPendingMigrations(): string[] {
  return readdirSync(MIG_DIR)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .filter((f) => !f.startsWith('000_'))
    .sort();
}
export const PENDING_MIGRATIONS: string[] = discoverPendingMigrations();
// skipIf(!hasNeonKey) v testech — lokálně vždy "ano"; žádný Neon klíč se nepoužívá.
export const hasNeonKey = true;

export interface LiveClone {
  pool: Pool;
  branchId: string;
  uri: string;
  cleanup: () => Promise<void>;
}

const strip = (sql: string) =>
  sql.split('\n').filter((l) => !/^\\(un)?restrict\b/.test(l)).join('\n');

export async function createLiveClone(
  label: string,
  opts: { migrations?: string[]; exclude?: string[] } = {},
): Promise<LiveClone> {
  const dbName = `live_${label.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 30)}_${Date.now()}`;
  const admin = new Client({ connectionString: `${OWNER}/neondb` });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName} TEMPLATE template0`);
  await admin.end();

  const uri = `${OWNER}/${dbName}`;
  const pool = new Pool({ connectionString: uri, max: 6 });

  // OD NULY: baseline + globals, pak 4xx (celé, nebo dle opts), s vynecháním `exclude`.
  // Každý soubor na NOVÉM spojení (jako psql -f): baseline dělá session-level
  // set_config('search_path','') a to nesmí přetéct do dalších migrací.
  const runFile = async (f: string, filter = false) => {
    const c = new Client({ connectionString: uri });
    await c.connect();
    try {
      const sql = readFileSync(join(MIG_DIR, f), 'utf8');
      await c.query(filter ? strip(sql) : sql);
    } finally {
      await c.end();
    }
  };
  await runFile('000_baseline_20260730.sql', true);
  await runFile('000_baseline_globals.sql');
  const skip = (f: string) => (opts.exclude ?? []).some((x) => f.startsWith(x));
  const chosen = (opts.migrations ?? PENDING_MIGRATIONS).filter((f) => !skip(f));
  if (opts.exclude?.length) console.log(`[audit-fixture] RED stav — vynechano: ${opts.exclude.join(', ')}`);
  for (const f of chosen) await runFile(f);

  process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
  process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);

  const asOwner = process.env.LIVE_AS_OWNER === '1';
  if (asOwner) {
    process.env.DATABASE_URL = uri;
  } else {
    const pw = process.env.AUDIT_APP_PW ?? "auditapp"; // pevne: soubezne behy (app server, R-56) sdili globalni roli
    await pool.query(`ALTER ROLE tixly_app WITH PASSWORD '${pw}'`);
    process.env.DATABASE_URL = uri.replace(/\/\/[^@]+@/, `//tixly_app:${pw}@`);
  }
  console.log(`[audit-fixture] db=${dbName} handlery jako: ${asOwner ? 'neondb_owner' : 'tixly_app'}`);

  const cleanup = async (): Promise<void> => {
    await pool.end().catch(() => undefined);
    try {
      const { db: appDb } = await import('@/lib/db/rls-pool');
      await appDb().end();
    } catch {
      /* noop */
    }
    // DB se MAZE hned (kazda ma ~50 MB; nemazani zaplnilo disk hostitele). Dukazy jsou v logu behu.
    const a = new Client({ connectionString: `${OWNER}/neondb` });
    try {
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    } catch (e) {
      console.error('[audit-fixture] DB nesmazana:', dbName, (e as Error).message);
    } finally {
      await a.end().catch(() => undefined);
    }
  };
  return { pool, branchId: dbName, uri, cleanup };
}
