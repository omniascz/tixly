# Bug inventory — aktuální stav k 2026-05-15

> **MAJOR UPDATE 2026-05-15:** Po cross-reference s git logem se ukázalo, že drtivá většina P0-P3 z `mega-flow-action-plan.md` je **už hotová v commitech** (viz sekce „Co bylo už uděláno"). Tato inventura nyní reflektuje REÁLNÝ stav, ne stav před dev sessions.
>
> Tvůj BUG-INVENTORY v0.1 (33 bugů P0-P3) je z 90 % obsolete — viz git log:
> `git log --oneline --grep="P0\|P1\|P2\|P3"`

---

## ✅ Co bylo už uděláno v master (potvrzeno z git logu)

### P0 (blockery pro launch) — 4/4 hotové
- ✅ **P0-1 Stripe Checkout Sessions** + webhook handler (commit `6d3f282`)
- ✅ **P0-2 Centrální mailer** s podporou Resend/Postmark/SendGrid/SES (`2941aa6`)
- ✅ **P0-3 BulkGate** real API + mock fallback (`dbb4194`)
- ✅ **P0-4 hCaptcha** server-side verify + client widget (`236a6ae`)

### P1 (core mezery) — 8/8 hotové
- ✅ **P1-5/6 Refund self-service + částečný** (`c7379a4`)
- ✅ **P1-7 Ticket transfer** (`c7379a4`)
- ✅ **P1-8 SSE real-time seat stream** (`c7379a4`)
- ✅ **P1-9 Best available auto-select** (`3f47cce`)
- ✅ **P1-10 Holds & Kills** s 5 kategoriemi (`72ee6a9`)
- ✅ **P1-11 Volume discount** tiers (`98d5ce9`)
- ✅ **P1-12 Push notif** VAPID + mock fallback (`439e562`)

### P2 (revenue features) — 6/9 hotové
- ✅ **P2-13 Marketplace Ads CPC** sponsored placements (`b06d26c`)
- ✅ **P2-14 Promotér tier 1-4** + auto-upgrade cron (`f951cb6`)
- ✅ **P2-15 Sub-účty + RBAC** specializované role (`ec0fe7a`)
- ✅ **P2-16 Personalizované vstupenky** jméno per ticket (`614b2f9`)
- ✅ **P2-18 Payment plan + Stripe saved card** (`a1c0c67`)
- ✅ **P2-19 Benefit systémy** (Pluxee/Benefit+/Gallery Beta/Edenred) (`cdcf23e`)
- 🟡 **P2-17 Apple/Google Pay native** — pravděpodobně přes Stripe Checkout (ověřit)
- 🔴 **P2-20 Dynamický rotující QR** — ZBÝVÁ
- 🟡 **P2-21 WYSIWYG email editor** — částečně (`8488e95` preview + test send, ale ne plný WYSIWYG)

### P3 (vertikály) — 7/7 hotové
- ✅ **P3-22 Timed entry slots** (`4b369d1`)
- ✅ **P3-23 Bank transfer reconciliation + VS auto-match** (`bd95ff9`)
- ✅ **P3-24 Chargeback workflow** + admin list (`420e9f6`)
- ✅ **P3-25 Re-entry rules + exit scan** (`5551762`)
- ✅ **P3-26 Loyalty bodový program** s tier multiplierem (`10bf618`)
- ✅ **P3-27 Akreditace** apply + admin approve flow (`d317632`)
- ✅ **P3-28 AI generování popisů** přes Anthropic API (`b5cdd04`)

### Tier-1 (international readiness) — 4/4 hotové
- ✅ **Tier-1 #1 iframe embed widget** (`fe40dd9`)
- ✅ **Tier-1 #2 WCAG 2.1 AA audit** + helpers (`fde40aa`)
- ✅ **Tier-1 #3 Public GraphQL** read-only API (`0946677`)
- ✅ **Tier-1 #4 PSD2 OAuth2** — KB/ČS/ČSOB bank integration (`b05c9a9`)

### Catch-up bonus (něco navíc) — 20 commitů
- catch-up #1–#20: SMS magic link, X.509 PAdES, discount kinds, vouchers,
  i18n EN+SK, partner POS, B2B reservation, Fio bank auto-pull, POS thermal,
  events na mapě, recommendations, RSVP, Verified Fan, editorial blog,
  catch-up #17 heat-map, reviews & ratings.

**Stav: ~88 % feature plánu z `mega-flow-action-plan.md` je hotových v master.**

---

## 🔴 Reálně zbývající P0 (blockery pro launch)

Po deploy je třeba **jen produkční konfigurace** (žádný kód):

### B1 — Stripe **live** key + ověřený webhook
- **Kód:** ✅ hotový (`6d3f282`)
- **Co chybí:** přepnout z `sk_test_*` na `sk_live_*`, KYC business, doménová verifikace
- **Tier:** C (tvoje)
- **Effort:** 1-3 dny Stripe KYC

### B2 — Resend **production** API key + verified doména
- **Kód:** ✅ hotový (`2941aa6`)
- **Co chybí:** Resend účet, DKIM/SPF/DMARC v DNS, API key v env
- **Tier:** C
- **Effort:** 30-60 min + DNS propagace

### B3 — BulkGate **production** API key
- **Kód:** ✅ hotový (`dbb4194`)
- **Co chybí:** BulkGate account + credit + Application ID/token
- **Tier:** C
- **Effort:** 1-2 dny verifikace

### B4 — hCaptcha **production** site/secret key
- **Kód:** ✅ hotový (`236a6ae`)
- **Co chybí:** hCaptcha site setup + keys v env
- **Tier:** C
- **Effort:** 10 min

### B5 — IČO + DIČ + business bank account
- **Stav:** ❌ právní úkon
- **Tier:** D (tvoje)

---

## 🟠 P0.5 — kódové fixy zbývající

### B6 — UNIQUE NULLS NOT DISTINCT na event_seats ✅
- **Stav:** ✅ **MIGRACE 264 NAPSANÁ** (`migrations/264_event_seats_nulls_not_distinct.sql`)
- **Co:** Idempotentní migrace s PG 15+ check, dedup keep-first, drop + add s NULLS NOT DISTINCT.
- **Effort zbývá:** 0 (otestovat při dalším deploy)

---

## 🟡 P1-P2 zbývající (Tier A — můžu sám)

### B20 — Dynamický rotující QR (P2-20) ✅
- **Stav:** ✅ HOTOVO v catch-up #1 (commit `be7a7a7`)
- **Důkaz:** `src/app/[locale]/t/[token]/SmsTicketClient.tsx` — fullscreen mobile QR, auto-refresh každých 30s, visual countdown, status badge (used/active). TOTP s window ±1 (`src/lib/totp/verify.ts`).
- **Endpoint:** `/api/public/tickets/[token]/totp` — HMAC-signed token, public, ale unguessable.

### B21 — Plný WYSIWYG email editor (P2-21) ✅
- **Stav:** ✅ HOTOVO — toolbar enhancement (bez TipTap dependency)
- **Co máme:** Quick-insert variable chips per template type, 6 formátovacích buttonů (B/I/H2/link/¶/↵), 4 hotové bloky (CTA / Info box / Detail řádek / Footer), Ctrl+B shortcut, live iframe preview, test send.
- **Pozn:** Plný TipTap by byl overkill — emaily mají striktní CSS limity (inline only, no flex), bohaté WYSIWYG by generovalo rozbité HTML. Toolbar přístup je SMSticket-style.

### B22 — Apple/Google Pay v checkout (P2-17 verify)
- **Stav:** 🟡 přes Stripe Checkout pravděpodobně automaticky
- **Co overit:** Stripe Payment Request API enabled, native button vidí mobile users
- **Effort:** 0-1 den (jen konfigurace)

### B23 — Konsolidace `/api/checkout` vs `/api/checkout-demo`
- **Stav:** 🟡 z DEMO-PROGRESS.md odložené
- **Effort:** 1 den

---

## 🐛 Bugy nalezené při audit (mimo P0-P3 plán)

### B30 — `event_seats` nemá CREATE TABLE v migracích ✅
- **Stav:** ✅ **HOTOVO** — migrace `069_event_seats_base.sql` napsaná
- **Co:** `catalog.event_seats` byla v dev DB vytvořena ručně přes psql, **NIKDY** nebyla v žádné migraci. Migrace 240 a 264 ji už ALTER-ují, takže fresh deploy by selhal.
- **Fix:** Migrace 069 (IF NOT EXISTS) — kompletní CREATE TABLE rekonstruováno z code usage. Indexy + trigger pro updated_at. Idempotent.
- **Effort skutečný:** 1 hodina
- **Co overit při deploy:** Spustit `./scripts/run-migrations.sh` proti fresh Neon, ověřit že 069 → 240 → 264 prošlo bez chyby.

### B31 — `event_seats` DDL trace — kde to bylo vytvořeno?
- **Akce:** Před spuštěním produkce dump `\d catalog.event_seats` z dev DB a porovnat s tím, co je dosažitelné z migrace 001+.

---

## 🔥 In-code TODO/HACK komentáře (stále aktuální)

| Soubor | Co je tam | Severita |
|---|---|---|
| `src/lib/payment/benefits.ts:71` | TODO real provider redirect URL po vendor docs | P2 (po smluvním kontraktu = Tier C dep) |
| `src/lib/scanner/offline-queue.ts:15` | TODO ticket IDs whitelist před akcí | P1 |
| `src/app/admin/events/[id]/member-pricing/page.tsx:85` | TODO better filter | P3 |
| `src/app/api/buyer/orders/[orderId]/refund/route.ts:12` | TODO tabulka `refund_requests` | P2 (low impact) |
| ~~`src/app/api/events/[id]/unlock-access-code/route.ts:16`~~ | ~~TODO rate limiting v produkci~~ | ✅ HOTOVO (per-tenant rate-limit 20/5min per IP+event) |
| `src/app/api/buyer/subscriptions/[id]/route.ts:8` | TODO refund prorata | P2 |

---

## 🧹 Code hygiene

- [x] ~~Konsolidovat `/api/checkout` vs `/api/checkout-demo`~~ — už hotové, jen `/api/checkout` existuje
- [x] **B30** — `069_event_seats_base.sql` migrace napsaná (CREATE TABLE event_seats)
- [x] **TypeScript build** — 8 reálných bugů opraveno (JSX quotes v embed/page, order-completed user_id + issued scope, recommendations recent_sales, partner sales arg order, PushSubscribeButton typing, 3 unused vars)
- [x] **Testy admin-api** — aktualizované na nový server-side aggregation endpoint (2 obsolete tests nahrazeno 2 novými)
- [ ] Přepracovat `seed.sql` (broken column "seq") nebo odstranit
- [ ] Snížit `relation already exists` warningy v init scriptu

---

## 📦 Unstaged tree state (k 2026-05-15)

| Soubor / Folder | Co je |
|---|---|
| `nextjs-boilerplate/src/app/[locale]/blog/` | Blog veřejná stránka (catch-up #15 byl, folder nový) |
| `state/` | Dev helper files |
| `scripts/md-to-html.mjs` | Script pro generování HTML/PDF z .md |
| `A11Y_AUDIT.{html,pdf}` | Build z .md |
| `DEPLOYMENT.{html,pdf}` | Build z .md |
| `mega-flow-*.{html,pdf}` | Build z .md |

→ Buď do `.gitignore` nebo commit.

---

## TOP 5 prioritních fixů (REÁLNÝ Tier A backlog)

1. **B30 — event_seats CREATE TABLE → migrace** (1-2 h) — KRITICKÉ pro fresh deploy
2. **B6 — Aplikovat migraci 264 NULLS NOT DISTINCT** při dalším deploy (0 práce, hotové)
3. **B22 — Ověřit Apple/Google Pay v Stripe Checkout flow** (test, 1 h)
4. **B23 — Konsolidovat /api/checkout vs /api/checkout-demo** (1 den)
5. **TODO 2 — Whitelist ticket IDs pro scanner offline mode** (P1 reliability, 1 den)

**Tier A backlog: ~3-5 dní práce.** Drasticky méně než předchozí odhad.

---

## TOP 5 Tier C blockerů (vyžadujou tebe)

1. **Stripe live keys + business KYC** (1-3 dny)
2. **Resend production + DNS records** (1 hodina + DNS propagace)
3. **BulkGate production account + credit** (1-2 dny verifikace)
4. **hCaptcha production keys** (10 min)
5. **Firebase / Web Push VAPID keys pro production** (10 min)

---

## TOP 3 Tier D úkony (mimo vývoj)

1. **IČO + DIČ + s.r.o. registrace**
2. **Business bankovní účet** (CZK + EUR)
3. **GDPR ToS + Privacy Policy + Cookie copy** (právník)

---

## Souvislost s GAP-MATRIX.md a PRODUCTION-READINESS.md

- Z **TOP 10 GAPů** vůči konkurenci je teď **8/10 hotových** v kódu, čeká se na produkční konfiguraci.
- Z **9 hard gates v PRODUCTION-READINESS.md** je realisticky **1 hotový** (WCAG audit), zbylých 8 čeká na deploy + business setup.
- **Reálný launch timeline:** 1-2 týdny po vyřízení Tier C+D (Stripe KYC je longest pole).

---

## Kam dál (po tomto refreshi)

**Tier A okamžitě dotáhnu**, bez tebe:
- B30 (find CREATE TABLE event_seats) — hned
- B22 (verify Apple Pay) — po B30
- Code hygiene cleanup — průběžně

**Tier C čeká na tebe:**
- Vyber 1-2 providery a založ účty (Stripe nejvíc bolí — začni s ním)

**Tier D čeká na tebe:**
- IČO + bank — naparalelně k Stripe KYC
