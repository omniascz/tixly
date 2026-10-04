/**
 * Pojistka testovacího prostředí (kolo 9 / krok 4).
 *
 * Při TIXLY_ENV=staging aplikace ODMÍTNE START, pokud kterákoli proměnná databáze nebo platební brány ukazuje
 * na produkci: produkční DB hostitel / Neon projekt, produkční GoPay / ComGate / Stripe / PayPal / Mollie / Triple-A,
 * produkční doména aplikace. Volá se z instrumentation.ts při bootu serveru (chyba = server nenastartuje).
 *
 * Seznam produkčních hostitelů: vestavěný (známý produkční Neon endpoint a projekt Tixly) + PROD_DB_HOSTS
 * a PROD_APP_HOSTS (čárkou oddělené) pro případ přesunu produkce.
 */

export const BUILTIN_PROD_DB_MARKERS = [
  'ep-weathered-wind-alvbjysw', // produkční Neon endpoint (tixly-production)
  'fragrant-wildflower-75132205', // produkční Neon projekt
];
export const BUILTIN_PROD_APP_HOSTS = ['app.tixly.cz', 'tixly.cz', 'www.tixly.cz'];

const DB_VARS = ['DATABASE_URL', 'DATABASE_URL_DIRECT', 'DATABASE_URL_SUPER', 'DATABASE_URL_OPS', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL'];

type Env = Record<string, string | undefined>;

function host(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}
const list = (v: string | undefined): string[] => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Vrátí seznam porušení (prázdný = v pořádku). Mimo staging vždy prázdný. */
export function stagingViolations(env: Env): string[] {
  if ((env.TIXLY_ENV ?? '').toLowerCase() !== 'staging') return [];
  const out: string[] = [];
  const dbMarkers = [...BUILTIN_PROD_DB_MARKERS, ...list(env.PROD_DB_HOSTS)];
  for (const v of DB_VARS) {
    const val = env[v];
    if (!val) continue;
    const h = host(val);
    const hit = dbMarkers.find((m) => h.includes(m) || val.toLowerCase().includes(m));
    if (hit) out.push(`${v} ukazuje na produkční databázi (${hit})`);
  }
  const appHosts = [...BUILTIN_PROD_APP_HOSTS, ...list(env.PROD_APP_HOSTS)];
  for (const v of ['APP_URL', 'NEXT_PUBLIC_APP_URL']) {
    const val = env[v];
    const h = val ? host(val) : '';
    if (h && appHosts.includes(h)) out.push(`${v} je produkční doména (${h})`);
  }
  // GoPay: produkční brána = gate.gopay.cz (bez GOPAY_SANDBOX=true nebo s explicitním produkčním override)
  if (env.GOPAY_GOID || env.GOPAY_CLIENT_ID) {
    const base = (env.GOPAY_API_BASE_URL ?? '').toLowerCase();
    if (env.GOPAY_SANDBOX !== 'true' && !base) out.push('GOPAY_SANDBOX není true — GoPay by šel na produkční bránu');
    if (base.includes('gate.gopay.cz')) out.push('GOPAY_API_BASE_URL míří na produkční GoPay (gate.gopay.cz)');
  }
  if (env.COMGATE_MERCHANT && env.COMGATE_TEST !== 'true') out.push('COMGATE_TEST není true — ComGate by vytvářel ostré platby');
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.startsWith('sk_test_')) out.push('STRIPE_SECRET_KEY není testovací klíč (sk_test_)');
  if (env.STRIPE_PUBLISHABLE_KEY && !env.STRIPE_PUBLISHABLE_KEY.startsWith('pk_test_')) out.push('STRIPE_PUBLISHABLE_KEY není testovací klíč (pk_test_)');
  if (env.PAYPAL_CLIENT_ID && env.PAYPAL_SANDBOX !== 'true') out.push('PAYPAL_SANDBOX není true');
  if (env.MOLLIE_API_KEY && !env.MOLLIE_API_KEY.startsWith('test_')) out.push('MOLLIE_API_KEY není testovací klíč (test_)');
  if (env.TRIPLEA_CLIENT_ID && env.TRIPLEA_SANDBOX !== 'true') out.push('TRIPLEA_SANDBOX není true');
  return out;
}

/** Vyhodí chybu (server nenastartuje), pokud staging ukazuje na produkci. */
export function assertStagingIsolated(env: Env = process.env): void {
  const v = stagingViolations(env);
  if (v.length) {
    throw new Error(`[staging-guard] Testovací prostředí odmítá start — ukazuje na produkci:\n - ${v.join('\n - ')}`);
  }
}
