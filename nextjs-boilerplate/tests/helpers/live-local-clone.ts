/**
 * Kolo 14 / krok 4 — lokální náhrada Neon klonu pro live testy (`createLiveClone` bez NEON_API_KEY).
 *
 * Neon klon = produkční větev + nenasazené migrace, handlery pod tixly_app, po testu se větev smaže. Lokálně (FIX_E2E=1,
 * server z FIX_DB_OWNER_URL — v CI service kontejner Postgres 17) totéž bez sítě a bez produkce:
 *   - schéma = baseline + globals + migrace 4xx–9xx (stejně jako .github/scripts/build-db-from-migrations.sh);
 *   - plný klon = CREATE DATABASE … TEMPLATE z šablony postavené JEDNOU za sadu migrací (název nese otisk souborů,
 *     staví se pod advisory zámkem a přejmenuje až hotová → souběžné soubory ji nikdy nevidí rozpracovanou);
 *   - `exclude` / `migrations` (RED stav bez migrace, nebo bez nenasazených migrací) = databáze postavená od nuly;
 *   - handlery běží jako tixly_app (RLS platí), LIVE_AS_OWNER=1 jako owner — stejně jako Neon fixture;
 *   - cleanup zavře pooly a databázi smaže (DROP … WITH (FORCE)).
 */
import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { Client, Pool } from 'pg';

const MIG_DIR = join('..', 'migrations');
const BASELINE = '000_baseline_20260730.sql';
const GLOBALS = '000_baseline_globals.sql';

export const hasLocalLiveDb = process.env.FIX_E2E === '1';

const ownerUrl = (): string => process.env.FIX_DB_OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/e2e';
const appUrl = (): string => process.env.FIX_DB_APP_URL ?? 'postgresql://tixly_app:fixapp@localhost:55632/e2e';
const withDb = (url: string, db: string): string => url.replace(/\/[^/?]+(\?|$)/, `/${db}$1`);

function numberedMigrations(): string[] {
  return readdirSync(MIG_DIR).filter((f) => /^[4-9]\d{2}_.*\.sql$/.test(f)).sort();
}

function migrationsFingerprint(files: string[]): string {
  const h = createHash('sha1');
  for (const f of [BASELINE, GLOBALS, ...files]) h.update(`${f}:${statSync(join(MIG_DIR, f)).size};`);
  return h.digest('hex').slice(0, 10);
}

async function applySchema(db: string, files: string[]): Promise<void> {
  // Každý soubor v NOVÉ session — jako psql v build-db-from-migrations.sh. Baseline z pg_dump nastaví
  // search_path = '' pro celou session; další migrace na tomtéž spojení by pak nenašly app_is_platform_admin() aj.
  const runFile = async (label: string, sql: string): Promise<void> => {
    const c = new Client({ connectionString: withDb(ownerUrl(), db) });
    await c.connect();
    try {
      await c.query(sql);
    } catch (err) {
      throw new Error(`[live-local-clone] migrace ${label} selhala: ${(err as Error).message}`);
    } finally {
      await c.end().catch(() => undefined);
    }
  };
  // \restrict / \unrestrict jsou psql meta-příkazy z pg_dump 17.10 — pg je nezná
  await runFile(BASELINE, readFileSync(join(MIG_DIR, BASELINE), 'utf8').replace(/^\\(un)?restrict .*$/gm, ''));
  await runFile(GLOBALS, readFileSync(join(MIG_DIR, GLOBALS), 'utf8'));
  for (const f of files) await runFile(f, readFileSync(join(MIG_DIR, f), 'utf8'));
  const appPw = decodeURIComponent(new URL(appUrl()).password || 'fixapp');
  await runFile('heslo tixly_app', `ALTER ROLE tixly_app WITH LOGIN PASSWORD '${appPw.replace(/'/g, "''")}'`);
}

async function admin<T>(fn: (p: Pool) => Promise<T>): Promise<T> {
  const p = new Pool({ connectionString: ownerUrl(), max: 1 });
  try { return await fn(p); } finally { await p.end().catch(() => undefined); }
}

async function ensureTemplate(files: string[]): Promise<string> {
  const tpl = `tixly_live_tpl_${migrationsFingerprint(files)}`;
  return admin(async (p) => {
    const c = await p.connect();
    try {
      await c.query(`SELECT pg_advisory_lock(hashtext('tixly_live_tpl'))`);
      const exists = (await c.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [tpl])).rowCount;
      if (!exists) {
        const building = `${tpl}_build`;
        await c.query(`DROP DATABASE IF EXISTS "${building}" WITH (FORCE)`);
        await c.query(`CREATE DATABASE "${building}" TEMPLATE template0`);
        console.log(`[live-local-clone] stavím šablonu ${tpl} z migrací (${files.length} souborů)…`);
        await applySchema(building, files);
        await c.query(`ALTER DATABASE "${building}" RENAME TO "${tpl}"`);
      }
      return tpl;
    } finally {
      await c.query(`SELECT pg_advisory_unlock(hashtext('tixly_live_tpl'))`).catch(() => undefined);
      c.release();
    }
  });
}

export interface LocalLiveClone { pool: Pool; branchId: string; uri: string; cleanup: () => Promise<void> }

export async function createLocalLiveClone(
  label: string,
  opts: { migrations?: string[]; exclude?: string[] } = {},
): Promise<LocalLiveClone> {
  const all = numberedMigrations();
  const name = `live_${label.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 30)}_${Date.now().toString(36)}`;
  const custom = opts.migrations !== undefined || (opts.exclude?.length ?? 0) > 0;
  if (!custom) {
    const tpl = await ensureTemplate(all);
    await admin((p) => p.query(`CREATE DATABASE "${name}" TEMPLATE "${tpl}"`));
  } else {
    // migrations: [] = jen baseline (Neon: produkce bez nenasazených migrací); exclude = RED stav bez dané migrace
    const chosen = (opts.migrations ?? all)
      .filter((f) => /^[4-9]\d{2}_/.test(f))
      .filter((f) => !(opts.exclude ?? []).some((x) => f.startsWith(x)));
    if (opts.exclude?.length) console.log(`[live-local-clone] RED stav — vynechano: ${opts.exclude.join(', ')}`);
    await admin((p) => p.query(`CREATE DATABASE "${name}" TEMPLATE template0`));
    await applySchema(name, chosen);
  }

  // prostředí jako u lokálních live testů (tajemství, SMTP, brány → simulátory), DB = klon
  const { setupLocalEnv } = await import('./local-fixture');
  setupLocalEnv();
  process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
  const ownerUri = withDb(ownerUrl(), name);
  const asOwner = process.env.LIVE_AS_OWNER === '1';
  process.env.DATABASE_URL = asOwner ? ownerUri : withDb(appUrl(), name);
  process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL;
  console.log(`[live-local-clone] ${name}: handlery běží jako ${asOwner ? 'owner (BYPASSRLS — RLS SE NEMĚŘÍ)' : 'tixly_app (RLS platí)'}`);

  const pool = new Pool({ connectionString: ownerUri, max: 6 });
  const cleanup = async (): Promise<void> => {
    await pool.end().catch(() => undefined);
    try {
      const { db: appDb } = await import('@/lib/db/rls-pool');
      await appDb().end();
    } catch { /* nikdy neinicializován / už zavřený */ }
    await admin((p) => p.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)).catch((e) =>
      console.error('[live-local-clone] databázi se nepodařilo smazat:', name, e));
  };
  return { pool, branchId: name, uri: ownerUri, cleanup };
}
