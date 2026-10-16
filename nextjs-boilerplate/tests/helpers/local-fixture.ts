/**
 * Lokální obdoba `live-fixture`, ale proti IZOLOVANÉ Postgres instanci postavené
 * z migrací (ne proti produkčnímu Neon klonu). Používá se pro regresní testy
 * kritických oprav (K1/K2/K3/V1), které se musí dát pustit bez NEON_API_KEY a
 * BEZ jakéhokoli spojení na produkci.
 *
 * Zapíná se jen když je nastaveno `FIX_E2E=1` a běží proti DSN z env:
 *   FIX_DB_OWNER_URL  — neondb_owner (seed + ground truth, BYPASSRLS)
 *   FIX_DB_APP_URL    — tixly_app    (pod kterou běží handlery, RLS platí)
 * Default míří na kontejner z audit/REPRO (localhost:55632/e2e).
 *
 * Handlery čtou DATABASE_URL při prvním importu `@/lib/db/rls-pool`, proto se
 * env musí nastavit PŘED dynamickým importem route handleru — voláním
 * `setupLocalEnv()` v `beforeAll`, teprve pak `await import('@/app/api/...')`.
 *
 * Seed factory je záměrně TÁŽ jako v live-fixture (`makeSeed`) — jedno místo
 * pravdy o tvaru dat; lístky se vydávají přes `issueTicketsForOrder`.
 */
import { Pool } from 'pg';
import { makeSeed } from './live-fixture';

export const hasLocalDb = process.env.FIX_E2E === '1';

const OWNER_URL =
  process.env.FIX_DB_OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/e2e';
const APP_URL_DSN =
  process.env.FIX_DB_APP_URL ?? 'postgresql://tixly_app:fixapp@localhost:55632/e2e';

export interface LocalClone {
  pool: Pool;
  seed: ReturnType<typeof makeSeed>;
  cleanup: () => Promise<void>;
}

/** Nastaví env tak, aby route handlery mířily na izolovanou DB + fake-gopay + mailpit. */
export function setupLocalEnv(): void {
  process.env.DATABASE_URL = APP_URL_DSN;            // handlery = tixly_app (RLS platí, jako v produkci)
  process.env.DATABASE_URL_DIRECT = APP_URL_DSN;     // není pooler → direct = totéž
  process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);
  process.env.JWT_SECRET ??= 'fix-jwt-secret-0123456789abcdef0123456789abcdef';
  process.env.INTERNAL_SERVICE_TOKEN ??= 'fix-internal-token-0123456789abcdef';
  process.env.CRON_SECRET ??= 'fix-cron-secret-0123456789abcdef';
  process.env.PAYMENT_PROVIDER ??= 'gopay';
  process.env.GOPAY_API_BASE_URL ??= 'http://localhost:3998/api';
  process.env.GOPAY_GOID ??= '8123456789';
  process.env.GOPAY_CLIENT_ID ??= 'fix-client';
  process.env.GOPAY_CLIENT_SECRET ??= 'fix-secret';
  process.env.SMTP_HOST ??= 'localhost';
  process.env.SMTP_PORT ??= '51225';
  process.env.EMAIL_FROM ??= 'vstupenky@tixly.fix';
  process.env.REDIS_URL ??= 'redis://localhost:56679';
  process.env.APP_URL ??= 'http://localhost:3100';
  process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3100';
  process.env.MODERATION_PROVIDER ??= 'mock';
  // demo/mock guardy se řídí NODE_ENV; typ je readonly, proto přes cast.
  (process.env as { NODE_ENV?: string }).NODE_ENV ??= 'production';
}

export async function createLocalClone(runId?: string): Promise<LocalClone> {
  setupLocalEnv();
  const pool = new Pool({ connectionString: OWNER_URL, max: 6 });
  const seed = makeSeed(pool, runId ?? String(Date.now()));
  async function cleanup() {
    await pool.end().catch(() => {});
    try {
      const { db } = await import('@/lib/db/rls-pool');
      await (db() as unknown as Pool).end?.().catch(() => {});
    } catch {
      /* rls-pool možná nebyl importován */
    }
  }
  return { pool, seed, cleanup };
}

/** Mailpit REST: najdi poslední e-mail pro adresáta. */
export async function mailpitLatest(to: string): Promise<{ id: string; html: string } | null> {
  const base = process.env.MAILPIT_URL ?? 'http://localhost:58225';
  const r = await fetch(`${base}/api/v1/search?query=${encodeURIComponent('to:' + to)}&limit=1`);
  const j = (await r.json()) as { messages?: Array<{ ID: string }> };
  const id = j.messages?.[0]?.ID;
  if (!id) return null;
  const m = await fetch(`${base}/api/v1/message/${id}`);
  const mj = (await m.json()) as { HTML?: string; Text?: string };
  return { id, html: mj.HTML ?? mj.Text ?? '' };
}
