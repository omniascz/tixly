// Kolo 10: úpravy GO-LIVE-INVENTORY.md (kroky 3 a 4). Každá náhrada musí sedět právě jednou.
const fs = require('fs');
const f = process.argv[2];
let s = fs.readFileSync(f, 'utf8');
function rep(a, b) {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error(`náhrada ${n}×: ${a.slice(0, 70)}`);
  s = s.replace(a, b);
}
function after(anchor, add) { rep(anchor, anchor + add); }

// §1.3 přepínače nedokončených cest
const nextPub = s.split('\n').find((l) => l.startsWith('| `NEXT_PUBLIC_APP_URL` |'));
after(nextPub, '\n'
  + '| `NEXT_PUBLIC_FEATURE_INSTALLMENTS` | **Kolo 10:** splátky (plány splátek, BNPL Twisto / Skip Pay, cron charge-installments). Vypnuto → checkout 422 `FEATURE_DISABLED`, API 404, UI skryté | **nenastavovat** (výchozí vypnuto; zapíná jen `1`; vkládá se při buildu) | — | `src/lib/features/launch-flags.ts` |\n'
  + '| `NEXT_PUBLIC_FEATURE_SUBSCRIPTIONS` | **Kolo 10:** předplatné / permanentky / abonentky (aktivace, checkout, uplatnění v checkoutu, cron renew-subscriptions). Vypnuto → 422 / 404, stránky 404 | **nenastavovat** | — | `src/lib/features/launch-flags.ts` |\n'
  + '| `NEXT_PUBLIC_FEATURE_BENEFIT_CARDS` | **Kolo 10:** benefitní karty (Pluxee, Edenred, …; chybí návratová URL). Vypnuto → checkout 422, callbacky 404, UI skryté | **nenastavovat** | — | `src/lib/features/launch-flags.ts` |');

// §1.8 e-mail
const resendRow = s.split('\n').find((l) => l.startsWith('| `RESEND_API_KEY` |'));
after(resendRow, '\n'
  + '| `RESEND_API_BASE_URL` | **Kolo 10:** základ Resend HTTP API (výchozí `https://api.resend.com`); jen pro testy se simulátorem | ne (nenastavovat) | — | `src/lib/notifications/platform-notify.ts` |\n'
  + '| `STAGING_EMAIL_ALLOWLIST` | **Kolo 10, jen staging:** e-mail odejde jen na tyto adresy / `@domény` (čárkou); mimo → neodešle se a zaloguje. S `TIXLY_ENV=staging` a prázdným allowlistem server nenastartuje | v produkci **ne**; na stagingu **povinná** | adresy testerů | `src/lib/email/staging-allowlist.ts`, `src/lib/env/staging-guard.ts` |');

// §1.12 #14, #15
rep('| Cron `charge-installments` (denně 03:00) označí splátku jako **zaplacenou bez stržení** (`mock-cron-…`) |',
  '| Cron `charge-installments` (denně 03:00) označí splátku jako **zaplacenou bez stržení** (`mock-cron-…`). **Kolo 10:** cron vyřazen z `vercel.json`, routa 404 bez `NEXT_PUBLIC_FEATURE_INSTALLMENTS=1` |');
rep('| Cron `renew-subscriptions` obnovuje předplatná **bez platby** (mock instant-renew) |',
  '| Cron `renew-subscriptions` obnovuje předplatná **bez platby** (mock instant-renew). **Kolo 10:** cron vyřazen z `vercel.json`, routa 404 bez `NEXT_PUBLIC_FEATURE_SUBSCRIPTIONS=1` |');

// §2 staging
rep('**Riziko:** chybějící `SMTP_HOST` znamená tiché selhání odesílání vstupenek',
  '**Staging (kolo 10):** staging nemá Mailpit — posílá přes Resend (`SMTP_HOST=smtp.resend.com`) skutečným lidem, proto\n'
  + 'povinný `STAGING_EMAIL_ALLOWLIST` (adresy nebo `@domény`, plus-adresy pasují). Filtr je v `sendMail` (všechny e-maily\n'
  + 'přes SMTP) i v `platform-notify` (Resend HTTP API); příjemce mimo allowlist se vyřadí a zaloguje maskovaně\n'
  + '(`[mailer] staging: příjemci mimo STAGING_EMAIL_ALLOWLIST …`). Prázdný / neplatný allowlist = server nenastartuje.\n'
  + 'Doručení ověřuje `scripts/staging/smoke.sh` přes seznam odeslaných zpráv Resend API (`GET /emails`). Viz `scripts/staging/README.md`.\n\n'
  + '**Riziko:** chybějící `SMTP_HOST` znamená tiché selhání odesílání vstupenek');

// §4.2 crony
rep('### 4.2 Registrované crony (`vercel.json:33-65`) — 31 záznamů',
  '### 4.2 Registrované crony (`vercel.json`) — 29 záznamů (kolo 10: vyřazeny #7 charge-installments a #8 renew-subscriptions)');
const r7 = s.split('\n').find((l) => l.startsWith('| 7 | `…job=charge-installments`'));
rep(r7, r7.replace('| 7 |', '| ~~7~~ |') + ' **Kolo 10: vyřazen z `vercel.json`** (splátky vypnuté) |');
const r8 = s.split('\n').find((l) => l.startsWith('| 8 | `…job=renew-subscriptions`'));
rep(r8, r8.replace('| 8 |', '| ~~8~~ |') + ' **Kolo 10: vyřazen z `vercel.json`** (předplatné vypnuté) |');
const r26 = s.split('\n').find((l) => l.startsWith('| 26 | **`/api/admin/lastminute/check`**'));
rep(r26, '| 26 | **`/api/admin/lastminute/check`** | `*/15 * * * *` | `src/app/api/admin/lastminute/check/route.ts` | Last-minute slevy podle obsazenosti | **Kolo 10 opraveno:** `GET` s `Authorization: Bearer CRON_SECRET` (isCronAuthorized), výjimka v middlewaru jen pro tento GET; opraven i dotaz (`lr.promoter_id` neexistoval → 42703). Bez / se špatným tajemstvím 401 (test `fix-r10-lastminute-cron.live`) |');
rep('17 z 31 cronů běží častěji než 1× denně', '17 z 29 cronů běží častěji než 1× denně');

// §4.3 payouts-execute
const pe = s.split('\n').find((l) => l.startsWith('| `src/app/api/internal/cron/payouts-execute/route.ts` |'));
rep(pe, '| `src/app/api/internal/cron/payouts-execute/route.ts` | Odeslání výplat (Wise / PayPal Payouts) po `payouts-auto-settle` | **Kolo 10: záměrně neregistrováno — výplaty jsou pro první ostrý provoz RUČNÍ.** Platform admin je spustí v administraci (`/api/admin/payouts/execute`); u CZK/FIO výplata přejde do stavu `awaiting_manual_transfer` (kolo 7), převod se odešle z internetového bankovnictví a admin ho potvrdí (`/api/platform/admin/payouts/[id]/confirm-transfer`). Test: dispatcher job nezná (422) |');

fs.writeFileSync(f, s);
console.log('ok');
