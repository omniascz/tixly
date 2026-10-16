/**
 * Společný základ sandbox testů platebních bran (kolo 7, krok 6) — tests/sandbox/*.sandbox.test.ts.
 *
 * Testy běží proti SKUTEČNÉMU sandboxu brány a izolované lokální DB (FIX_E2E=1, DB z migrací pod
 * tixly_app). Bez sandbox klíčů se přeskočí s hláškou. Nikdy nepoužijí produkční klíče ani hostitele:
 *   - klíče mají vlastní názvy (GOPAY_SANDBOX_*, COMGATE_SANDBOX_*) a do GOPAY_* / COMGATE_* se
 *     přepíšou až uvnitř testu;
 *   - assertSandboxTarget() odmítne produkční hostitele brány (gate.gopay.cz, ComGate bez test režimu)
 *     i jinou než lokální databázi.
 *
 * Krok „zaplacení" dělá člověk: test vypíše odkaz na platební bránu sandboxu, tester zaplatí testovací
 * kartou a test čeká (dotazem na API brány), dokud platba není PAID — SANDBOX_PAY_TIMEOUT_MS
 * (výchozí 5 min). Notifikaci brány na localhost nedoručí, proto test zavolá náš webhook in-process
 * se skutečným ID platby; webhook si stav ověří u brány sám.
 *
 * Spuštění: viz tests/sandbox/README.md.
 */
import type { NextRequest } from 'next/server';

export const SANDBOX_ENV = {
  gopay: ['GOPAY_SANDBOX_GOID', 'GOPAY_SANDBOX_CLIENT_ID', 'GOPAY_SANDBOX_CLIENT_SECRET'],
  comgate: ['COMGATE_SANDBOX_MERCHANT', 'COMGATE_SANDBOX_SECRET'],
} as const;

export const GOPAY_SANDBOX_API = 'https://gw.sandbox.gopay.com/api';
export const COMGATE_API = 'https://payments.comgate.cz/v2.0';
const PRODUCTION_HOSTS = ['gate.gopay.cz', 'gate.gopay.com'];

/** Chybějící proměnné (prázdné pole = lze spustit). Vypíše srozumitelnou hlášku o přeskočení. */
export function missingSandboxEnv(provider: keyof typeof SANDBOX_ENV): string[] {
  const missing: string[] = SANDBOX_ENV[provider].filter((k) => !process.env[k]);
  if (process.env.FIX_E2E !== '1') missing.push('FIX_E2E=1 (izolovaná lokální DB)');
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[sandbox:${provider}] PŘESKOČENO — chybí: ${missing.join(', ')}. Viz tests/sandbox/README.md.`);
  }
  return missing;
}

/** Ochrana proti produkci: brána jen sandbox / test režim, DB jen lokální. Vyhodí chybu, nikdy nepokračuje. */
export function assertSandboxTarget(provider: keyof typeof SANDBOX_ENV): void {
  for (const k of ['DATABASE_URL', 'FIX_DB_OWNER_URL', 'FIX_DB_APP_URL']) {
    const v = process.env[k];
    if (!v) continue;
    const host = new URL(v).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
      throw new Error(`[sandbox] ${k} míří na ${host} — sandbox testy smí jen proti lokální izolované DB.`);
    }
  }
  if (provider === 'gopay') {
    const host = new URL(process.env.GOPAY_API_BASE_URL ?? '').hostname;
    if (PRODUCTION_HOSTS.includes(host) || host !== new URL(GOPAY_SANDBOX_API).hostname) {
      throw new Error(`[sandbox] GoPay API ${host} není sandbox (${new URL(GOPAY_SANDBOX_API).hostname}).`);
    }
    if (process.env.GOPAY_SANDBOX !== 'true') throw new Error('[sandbox] GOPAY_SANDBOX musí být true.');
  }
  if (provider === 'comgate') {
    if (process.env.COMGATE_TEST !== 'true') throw new Error('[sandbox] ComGate jen v test režimu (COMGATE_TEST=true).');
    const host = new URL(process.env.COMGATE_API_BASE_URL ?? '').hostname;
    if (host !== new URL(COMGATE_API).hostname) throw new Error(`[sandbox] ComGate API ${host} není oficiální adresa brány.`);
  }
}

/** Nastaví GOPAY_* / COMGATE_* ze sandbox proměnných; vrátí funkci, která původní hodnoty obnoví. */
export function applySandboxEnv(provider: keyof typeof SANDBOX_ENV): () => void {
  const set: Record<string, string> =
    provider === 'gopay'
      ? {
          PAYMENT_PROVIDER: 'gopay',
          GOPAY_GOID: process.env.GOPAY_SANDBOX_GOID!,
          GOPAY_CLIENT_ID: process.env.GOPAY_SANDBOX_CLIENT_ID!,
          GOPAY_CLIENT_SECRET: process.env.GOPAY_SANDBOX_CLIENT_SECRET!,
          GOPAY_SANDBOX: 'true',
          GOPAY_API_BASE_URL: GOPAY_SANDBOX_API,
        }
      : {
          PAYMENT_PROVIDER: 'comgate',
          COMGATE_MERCHANT: process.env.COMGATE_SANDBOX_MERCHANT!,
          COMGATE_SECRET: process.env.COMGATE_SANDBOX_SECRET!,
          COMGATE_TEST: 'true',
          COMGATE_API_BASE_URL: COMGATE_API,
        };
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(set)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

/** order-completed (vydání vstupenek), které webhook volá přes HTTP, doručí in-process skutečnému handleru. */
export async function routeOrderCompletedInProcess(): Promise<() => void> {
  const realFetch = globalThis.fetch;
  const { POST: completed } = await import('@/app/api/internal/order-completed/route');
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (u.pathname === '/api/internal/order-completed') {
      return completed(new Request(`http://localhost${u.pathname}`, init) as unknown as NextRequest);
    }
    return realFetch(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

/** Čeká, dokud `check()` nevrátí true (dotaz na API brány). Vypíše odkaz pro testera. */
export async function waitForPayment(gatewayUrl: string, check: () => Promise<boolean>): Promise<void> {
  const timeout = Number(process.env.SANDBOX_PAY_TIMEOUT_MS ?? 300_000);
  // eslint-disable-next-line no-console
  console.log(`\n[sandbox] Zaplaťte testovací kartou do ${Math.round(timeout / 1000)} s:\n  ${gatewayUrl}\n`);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`[sandbox] platba nebyla zaplacena do ${timeout} ms (${gatewayUrl})`);
}

export const jsonReq = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): NextRequest =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
