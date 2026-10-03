// Vypise line-coverage kritickych modulu z coverage-summary.json (vitest v8).
// Pouziti: node audit/tools/coverage-critical.mjs audit/logs/07c_coverage-summary.json
import { readFileSync } from 'node:fs';
const s = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const CRIT = [
  'src/app/api/checkout/route.ts',
  'src/app/api/cart/validate/route.ts',
  'src/app/api/seats/hold/route.ts',
  'src/app/api/webhooks/gopay/route.ts',
  'src/app/api/webhooks/comgate/route.ts',
  'src/app/api/webhooks/stripe/route.ts',
  'src/app/api/internal/order-completed/route.ts',
  'src/lib/tickets/demo-issuer.ts',
  'src/app/api/admin/orders/[orderId]/refund/route.ts',
  'src/app/api/admin/orders/bulk-refund/route.ts',
  'src/app/api/buyer/orders/[orderId]/refund/route.ts',
  'src/app/api/buyer/orders/[orderId]/cancel/route.ts',
  'src/app/api/admin/refund-requests/[id]/route.ts',
  'src/app/api/admin/scanner/validate/route.ts',
  'src/lib/scanner/offline-queue.ts',
  'src/app/api/auth/login/route.ts',
  'src/app/api/auth/register/route.ts',
  'src/app/api/auth/forgot-password/route.ts',
  'src/app/api/auth/reset-password/route.ts',
  'src/app/api/auth/refresh/route.ts',
  'src/middleware.ts',
  'src/lib/db/rls-pool.ts',
  'src/lib/identity/guest-user.ts',
  'src/app/api/internal/cron/expire-pending-orders/route.ts',
  'src/app/api/internal/cron/release-expired-seat-holds/route.ts',
  'src/app/api/promo-codes/validate/route.ts',
  'src/lib/pricing/resolve-price.ts',
  'src/lib/totp/verify.ts',
  'src/lib/payment/provider.ts',
  'src/lib/payment/mock-guard.ts',
  'src/lib/email/mailer.ts',
  'src/app/api/kiosk/order/route.ts',
];
const norm = (f) => f.replace(/\\/g, '/').split('nextjs-boilerplate/')[1];
const byRel = new Map(Object.entries(s).filter(([f]) => f !== 'total').map(([f, v]) => [norm(f), v]));
for (const c of CRIT) {
  const v = byRel.get(c);
  if (!v) { console.log('   n/a              ' + c + '  (soubor neni v reportu)'); continue; }
  console.log(String(v.lines.pct).padStart(6) + '%  ' + `${v.lines.covered}/${v.lines.total}`.padStart(10) + '  ' + c);
}
const t = s.total.lines;
const zero = [...byRel.values()].filter((v) => v.lines.pct === 0).length;
console.log(`\nTOTAL lines ${t.pct}% (${t.covered}/${t.total}); souboru v reportu ${byRel.size}, z toho s 0 % radku: ${zero}`);
