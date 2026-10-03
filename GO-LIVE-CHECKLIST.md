# 🚀 Tixly — GO-LIVE Checklist (cesta k 100 % ostrému provozu)

> Odškrtávej `[ ]` → `[x]`, jak postupuješ. Aktualizováno: **2026-06-08** (RLS Fáze 2 dokončena + ověřena, CZ/SK kód hotový).
> **Legenda:** 🧑 = ty (tvůj účet/billing/podpis) · 🤖 = udělám/pomůžu já · ⏱ = doba · 🔗 = na čem to závisí

> ⚠️ **NEJDŮLEŽITĚJŠÍ ZMĚNA OPROTI MINULE:** Tuhle session jsem deep E2E otestoval **30 funkcí**
> a opravil **~24 reálných bugů** (promotér se nemohl ani zaregistrovat, refund/scanner/vouchers
> padaly). **VŠECHNY tyhle opravy jsou na větvi `feature/rls-phase2-enforcement`, NE na produkci.**
> Produkce běží STARÝ kód z masteru = stále rozbitý. Viz nová **FÁZE 1A — Nasazení** níže. To je
> teď ten skutečný blocker (vedle GoPay).

---

## ✅ FÁZE 0 — Hotovo (technický základ stojí)

- [x] **Vercel hosting** + auto-deploy z `master` (🤖)
- [x] **Vercel build OPRAVEN** — chyběl Root Directory `nextjs-boilerplate` (🤖) — první úspěšný build v historii
- [x] **Neon Postgres (produkce)** — domigrováno na 339, ověřeno zdravé (🤖)
- [x] **Upstash Redis** — provisionováno, ověřeno (DB+Redis ok) (🤖)
- [x] **Klíče/secrets na Vercelu** — JWT, ENCRYPTION_KEY, CRON, INTERNAL, VAPID (🤖)
- [x] **RLS Fáze 2 DOKONČENA** (tenant izolace) — všech 7 nechráněných tabulek izolováno (migr. 351–354),
  5 admin server-stránek napojeno na kontext (+IDOR fix). Ověřeno pod ENFORCED RLS: **e2e-full-suite 42/42**
  (vč. tenant izolace A↔B) + smoke 166 endpointů. Na větvi `feature/rls-phase2-enforcement` (pushnuto).
  Produkce dál BYPASSRLS dormant; flip = po deploy + staging (sekce 7, NE blocker). (🤖, 2026-06-08)
- [x] **CZ/SK kód ověřen HOTOVÝ** — DPH country-aware (SK 5 %/CZ 10 %, 15 testů), variabilní symbol,
  EUR payouts per-currency, SK právní texty (draft). Tax+accounting 25/25. Zbývá jen právník. (🤖, 2026-06-08)
- [x] **Produkce běží** — `health/ready {database:ok, redis:ok}`, login funguje (🤖)
- [x] **Re-ověřeno 2026-06-03** — prod `health/ready` 200 `{database:ok, redis:ok}` (🤖)
- [x] **Moderace obsahu — vision** — Claude posuzuje text I plakát; finální schválení master admin (🤖, viz FÁZE 1 → Bezpečnost)
- [x] **DEEP E2E TESTOVÁNÍ — 30 funkcí** (🤖, 2026-06-03) — celý životní cyklus + obrana + 30 funkcí
  ověřeno proti běžícímu serveru se zápisem do DB. **~24 reálných bugů opraveno** (golden-path,
  refund, scanner, vouchers, subscriptions, payment plans, RLS systémové). Skripty `scripts/e2e-*.mjs`.
- [x] **Smoke sweep 429 endpointů** — 6 GET + 0 POST bugů (po opravě), zbytek čistý (🤖)

> **Stav: tech stack běží, kód je důkladně otestovaný — ALE opravy nejsou na produkci.** Zbývá
> nasazení (FÁZE 1A) + externí účty.

---

## 🟥 FÁZE 1A — NASAZENÍ opraveného kódu (NEJVYŠŠÍ PRIORITA — bez toho je prod rozbitý)

> Celá tahle session = 24 oprav + 9 migrací (340–348). Vše na větvi `feature/rls-phase2-enforcement`.
> Produkce běží starý master. Pořadí JE DŮLEŽITÉ: **nejdřív migrace, pak deploy kódu** (kód počítá
> se schématem po migracích).

- [x] **1) Migrace 340–348 na produkční Neon** 🤖 ✅ **HOTOVO 2026-06-03** — aplikováno přes Neon
  connection string (neondb_owner). Ověřeno: `promoters.id`=gen_random_uuid(), 127 svc policies,
  audit constraint má 'promoter'. Bundle transakční (vše naráz).
- [x] **2) Merge `feature/rls-phase2-enforcement` → `master`** 🤖 ✅ **HOTOVO** — čistý fast-forward
  (53 commitů, origin/master byl obsažen ve feature, žádné konflikty). Push na origin/master = `99ca26c`.
- [x] **3) Deploy** 🤖 ✅ **HOTOVO** — Vercel auto-deploy z masteru proběhl (READY), `health/ready` 200.
- [x] **4) Smoke na produkci** 🤖 ✅ **HOTOVO** — registrace promotéra NA PRODUKCI vrací **HTTP 200**
  (předtím 500). Testovací promotér uklizen z prod DB.

> ✅ **NASAZENÍ DOKONČENO.** Produkce teď běží opravený kód (24 bugfixů) + migrace 340–348.
> Golden-path bug (promotér se nemohl zaregistrovat) je v produkci OPRAVENÝ.

### ⚠️ Kritická operační poznámka — ENCRYPTION_KEY
- [ ] **Ověřit, že prod `ENCRYPTION_KEY` je STABILNÍ a nikdy se nezmění** 🧑 — šifruje TOTP secrety
  vstupenek, bank credentials, FB tokeny (AES-256-GCM). **Když se klíč změní, VŠECHNA zašifrovaná
  data jsou nedešifrovatelná = vstupenky se nenaskenují.** (Lokálně se to už stalo — dev server má
  jiný klíč než `.env.local` po clobberu, viz dev poznámka.) Na produkci: klíč ulož bokem (1Password),
  nikdy nepřepisuj přes `vercel env pull` clobber.

---

## 🔴 FÁZE 1 — Kritická cesta ke spuštění (bez tohoto nelze brát peníze)

### Platby
- [ ] **GoPay merchant — smlouva + KYC** 🧑 ⏱ ~14 dní (nejdelší tyč — začni HNED)
  - https://www.gopay.cz/ → kontakt obchod → smlouva (IČO, KYC dokumenty, ID jednatelů)
  - KYC review (3-7 dní) → sandbox → live API (1-2 dny)
  - Webhook URL: `https://app.tixly.cz/api/webhooks/gopay`
  - [ ] Pošli mi credentials → 🤖 nastavím `GOPAY_GOID`, `GOPAY_CLIENT_ID`, `GOPAY_CLIENT_SECRET`, `GOPAY_API_URL`
- [ ] **ComGate (pro SK / EUR)** 🧑 ⏱ ~7-14 dní — *jen pokud chceš slovenské promotéry hned*
  - Provider abstrakce v kódu hotová, stačí klíče
- [ ] **Vypnout `GOPAY_MOCK`** na produkci 🤖 (až budou real klíče)

### Email
- [ ] **Resend — doména + API klíč** 🧑 ⏱ 30 min + 1-2 dny DNS propagace
  - https://resend.com/signup → Add Domain `tixly.cz`
  - [ ] Vlož 3 DNS záznamy (SPF/DKIM/DMARC) do DNS pro `tixly.cz`
  - [ ] Vytvoř API key → pošli mi → 🤖 nastavím `SMTP_*` + `EMAIL_FROM=vstupenky@tixly.cz`
  - **Proč kritické:** bez emailu kupec nedostane lístek ani potvrzení

### Doména
- [x] **`app.tixly.cz` přidaná ve Vercel projektu** 🤖 (2026-06-02) — `tixly.cz` už je v účtu, vlastnictví ověřené
- [x] **Deployment Protection vyřešena** 🤖 — projekt má `all_except_custom_domains`: custom doména (`app.tixly.cz`) je veřejná automaticky, interní Vercel URL zůstávají zamčené. Žádná akce navíc.
- [ ] **JEDEN DNS záznam u tvého DNS providera** 🧑 ⏱ 5 min + propagace
  - Typ: **CNAME** · Název: **`app`** · Hodnota: **`cname.vercel-dns.com`** (TTL auto)
  - Po propagaci se SSL vystaví sám a `app.tixly.cz` naběhne (teď `misconfigured: true` = čeká jen na tenhle záznam)
  - [ ] 🤖 po naběhnutí ověřím HTTPS + nastavím `NEXT_PUBLIC_APP_URL=https://app.tixly.cz`

### Právní (CZ + SK)
- [ ] **Ověřit: Tixly s.r.o. + IČO + DIČ** 🧑 (dle poznámek hotové — potvrď)
- [ ] **Ověřit: Fio bankovní účet CZK + EUR** 🧑 (dle poznámek hotové — potvrď)
- [ ] **Obchodní podmínky (ToS) — CZ** 🧑 (právník / šablona)
- [ ] **Obchodní podmínky (ToS) — SK** 🧑 (jiný právní řád)
- [ ] **GDPR / zpracování osobních údajů** 🧑 (CZ zák. 110/2019 + SK 18/2018)
- [ ] **DPH nastavení** — CZ 21 %/10 % kultura, SK 23 %/5 % kultura 🧑 (promotér si nastaví v profilu, ale ověř že to sedí)

### Bezpečnost a moderace obsahu (DSA + ochrana značky)
- [x] **3-vrstvá moderace + vision** 🤖 — keyword blocklist → AI gate (text **i plakát**) → lidská fronta `/platform/event-moderation`. Audit log pro DSA. (hotovo 2026-06-02)
- [x] **Blocklist naseedovaný** 🤖 — extremistické/hate/scam termíny v `catalog.moderation_blocklist` (heil, sieg heil, judenfrei, white power, …)
- [ ] **`ANTHROPIC_API_KEY` na produkci** 🧑 (zakládáš separátní klíč) → 🤖 nastavím. **BEZ NĚJ vision plakátu nejede** (jen text + blocklist + člověk)
- [ ] **`MODERATION_PROVIDER` ≠ `mock` na produkci** 🤖 — past: s klíčem ale `=mock` zůstane mock. Nastavím na `claude` (nebo nechám prázdné)
- [x] **`MODERATION_AUTO_PUBLISH_DISABLED=1`** 🤖 — finální „publikovat" vždy klikne master admin (doporučeno pro start; default v `.env.example`)
- [ ] **Smoke test naživo** 🤖 — založit akci s problematickým plakátem → ověřit, že spadne do fronty, ne do prodeje (až bude klíč)

---

## 🟡 FÁZE 2 — Silně doporučeno před spuštěním (provoz a důvěra)

- [ ] **Sentry** (error tracking) 🧑 ⏱ 5 min — https://sentry.io → DSN → 🤖 nastavím
- [ ] **Better Uptime** (alert na výpadek) 🧑 ⏱ 5 min — monitor na `/api/health/ready`
- [ ] **Apple Wallet PassType cert** 🧑 ⏱ ~7 dní — Apple Developer Program (99 USD/rok) → `.p12` cert → 🤖 nastavím (teď passy nepodepsané)
- [ ] **Google Wallet issuer** 🧑 ⏱ ~3 dny — service account JSON → 🤖 nastavím
- [ ] **Backup / DR ověření** 🧑 (Neon console) — PITR je default zapnutý; ověř **retention window** (free ~1 den, Launch ~7 dní). Pro ostrý provoz doporučeno ≥7 dní → případně upgrade plánu

---

## 🟧 FÁZE 2B — ŠKÁLOVÁNÍ na hot onsale (tisíce prodejů za vteřiny)

> ⚠️ **Zjištěno zátěžovým testem 2026-06-03.** Pro divadlo / stálý prodej (stovky/hodiny) NENÍ potřeba.
> **Kritické JEN pro velký onsale** (festival headliner, Karel Gott reissue). Bez tohoto by hot onsale
> selhal. Detail viz commit `perf(checkout)` + `scripts/load-test.mjs`.

- [x] **Checkout — zkráceno držení zámku** 🤖 (2026-06-03) — `FOR UPDATE` se nedrží přes celou
  transakci; inventář se rezervuje atomicky až před commitem. **Eliminován katastrofální hang**
  (před: 600 souběžných = server tuhl 30s + zombie transakce; po: fast-fail 9s, 0 oversell).
  Pool dostal `statement_timeout`. Naměřeno: 1 instance jede čistě ~30-50 souběžných (51 req/s).
- [x] **Virtuální fronta — OVĚŘENA** 🤖 (2026-06-03) — `scripts/e2e-queue.mjs` 10/10: fronta reálně
  gatuje checkout (bez admitted tokenu odmítnut, pouští ve vlnách, token jednorázový). Promotér ji
  zapne na hot akci přepínačem `queue_enabled` + `queue_max_concurrent`. **Hlavní páka pro „tisíce/s".**
- [x] **Neon pooler** 🤖 ✅ — prod `DATABASE_URL` (z Neon integrace) UŽ JE pooled endpoint
  (`ep-…-pooler`). Default `PG_POOL_MAX=10` per-instance je pro serverless OK.
- [ ] 🔴 **Rotace hesla `neondb_owner`** 🧑 — hodnota `DATABASE_URL` včetně hesla byla
  **vystavena mimo repo**. V historii repa NENÍ (ověřeno před pushem: `git log -S` na
  `npg_`, `DATABASE_URL=postgres` a další vzory = 0 commitů), ale heslo se má rotovat.
  Dělá se **jednou návštěvou Neon konzole spolu s** `ALTER ROLE tixly_app WITH PASSWORD`
  níže — obojí je táž obrazovka. Po rotaci přepsat `DATABASE_URL` ve Vercelu.
- [ ] 🔴 **`ALTER ROLE tixly_app WITH PASSWORD '…'` + přepnout prod `DATABASE_URL` na `tixly_app`** 🧑 —
  **DOLOŽENO (FINDINGS §209): prod dnes běží jako `neondb_owner`, takže 596 policies
  je INERTNÍCH a RLS se nevynucuje.** Tohle není hygiena, je to jediná věc, která
  policies zapne.
  ⛔ **POŘADÍ JE PEVNÉ:** nejdřív nasadit opravu R-56 (už je v `master`), teprve pak
  přepnout roli. Obráceně vzniknou prázdné seznamy a 42501 napříč aplikací, které
  vypadají jako vada RLS — a hledaly by se v policies, kde nejsou (§209 bod 3).
- [ ] **Migrace 472–479 na produkci** 🤖 (2026-10-03) — vrstva nabídka → rozpočet →
  vyúčtování → výplata umělci + opce na termín + re-entry (472–478) a oprava policies
  `royalty_*` (479, R-58). **Na produkci dnes NEJSOU** (ověřeno `information_schema`).
  Všech 8 se na prod schéma aplikuje bez chyby (klon, `tests/booking-settlement.live.test.ts`
  + `tests/red-green-479.live.test.ts`). Pořadí: migrace → deploy kódu.
  ⚠️ **479 musí jít PŘED přepnutím na `tixly_app`** — bez ní pod produkční rolí nejde
  založit smlouvu s umělcem (42501) ani přijmout nabídku agentem (500). FINDINGS_RLS §210.
- [ ] **R-56: dva pooly — ověřit env na produkci** 🧑 — od R-56 jde `db().connect()` na
  **přímý** endpoint a `db().query()` na poolovaný (FINDINGS_RLS §191–§194). Přímé URI se
  odvodí z `DATABASE_URL` odstraněním `-pooler`, takže **obvykle není co nastavovat** —
  ale je potřeba potvrdit dvě věci:
  1. ✅ **POTVRZENO (§209): prod host OBSAHUJE `-pooler`.** R-56 byla ŽIVÁ produkční
     vada, ne jen vlastnost tvaru kódu. Oprava dvěma pooly (v `master`) ji hasí.
  2. **`PG_DIRECT_POOL_MAX=4`** a **`PG_DIRECT_IDLE_TIMEOUT_MS=10000`** ve Vercel env
     (defaulty v kódu jsou stejné, tohle je jen pojistka pro ladění bez deploye).
     Rozpočet: ~855 slotů / 4 = ~213 souběžných instancí. Detail: `db/ONSALE-PLAYBOOK.md` §1b.
  ⚠️ Čísla platí pro compute **0.25–2 CU**; při změně compute se `max_connections` mění
  a musí se přeměřit.
- [ ] **Zátěžový test na NASAZENÉ produkci** 🤖 — `scripts/load-test.mjs` proti app.tixly.cz
  (s frontou + poolerem) → definitivní strop. Lokální test = jen 1 proces, Vercel škáluje horizontálně.
- [ ] **Vercel: spending limit + concurrency alert** 🧑 — ať on-sale špička nepřekvapí fakturou/limitem.
- [ ] *(volitelné, větší)* **Odlehčit fraud ML scoring v checkoutu** 🤖 — největší CPU žrout v checkoutu;
  async / lehčí model zvedne propustnost per-instance.

---

## 🟢 FÁZE 3 — Mock integrace → ostré (klidně až PO spuštění)

> Tyto features fungují v demu (mock), kód je real-ready, čekají jen na vendor onboarding. **Nejsou launch blocker.**

- [ ] **Facebook Event 1-click publish** 🧑 — Meta App Review ⏱ 2-4 týdny → 🤖 napojím
- [ ] **Spotify Discovery** 🧑 — Spotify Developer klíče (OAuth) → 🤖 napojím
- [ ] **MHD Kombi-Ticket** 🧑 — partnerství s DPP/IDOS → 🤖 napojím
- [ ] **Benefit karty** (Pluxee/Sodexo/Edenred) 🧑 — smlouvy s vendory → 🤖 napojím
- [ ] **BNPL** (Twisto / Skip Pay) 🧑 — API smlouva → 🤖 napojím (UI hotové)
- [ ] **SMS** (BulkGate / Twilio) 🧑 — API klíč → 🤖 napojím
- [ ] **B2B API psaní** (vytvořit akci přes API) 🤖 — doimplementovat (teď stub)

---

## 🔍 FÁZE 4 — Ověření „funguje to NAŽIVO"

> **Velká část už OVĚŘENA deep E2E** (2026-06-03) proti běžícímu serveru se zápisem do DB —
> `[x]` níže = otestováno automatizovaně (ne jen „vše zelené", ale s ověřením v DB + nalezenými bugy).
> Co zbývá `[ ]` = potvrdit **na produkci po deployi**, hlavně s **reálnou platbou** (GoPay).

- [x] **Golden path** (browse → checkout → platba mock → lístek → sken) — E2E 30/30
- [x] **Založení akce + moderace** — E2E (registrace→schválení→akce→moderace→publish)
- [x] **Velký festival** — modulární pass (den × zóna), access matrix, cross-pass — E2E
- [x] **Subscriptions / abonmá** — plán→předplatné→100% sleva+spotřeba — E2E
- [x] **Resale (FanSALE)** — prodej dál + reissue (revoke originál, nový TOTP) — E2E
- [x] **Pojištění storna** — checkbox + premium + claim → refund + revoke — E2E
- [x] **Refund** — vrátit peníze, uvolnit sedadlo/inventář — E2E
- [x] **POS + Scanner** — walk-in prodej + sken + anti-passback — E2E
- [x] **Promotér onboarding + Master admin** — registrace, schválení, moderace — E2E
- [x] **Další: promo, loyalty, group, vouchers, gift, bank transfer, BNPL, lottery, GDPR,
      payment plans, entry slots, waitlist, accreditation, will-call, affiliate, RFID,
      white-label, charity, NFC** — vše E2E (8 dávek)
- [ ] **🔴 Golden path NAOSTRO s reálnou platbou** 🧑+🤖 — po GoPay: kup lístek za skutečné peníze,
  ověř že přijde email s QR a naskenuje se. (Jediné, co E2E nepokryje — reálná platební brána.)
- [ ] **Wallet (Apple/Google)** — passy se generují, ale nepodepsané (čeká certy, FÁZE 2)

---

## 🔵 FÁZE 5 — Po spuštění / růst (náskok, ne dohánění)

- [ ] **Nativní mobilní app** (React Native, buyer + scanner) ⏱ 4-6 týdnů — jediná velká věc, co konkurence (GoOut) má a my zatím suplujeme PWA
- [ ] **Veřejná pricing stránka** (nízká priorita)
- [ ] **RLS ostrý flip** (`ALTER ROLE ... NOBYPASSRLS`) — defense-in-depth, až bude čas na staging validaci pod enforce
- [ ] **První reální promotéři** (1-3) + první akce za peníze

---

## 📊 Rychlý přehled „kde jsme"

| Oblast | Stav |
|--------|------|
| Tech infra (hosting, DB, Redis, build) | ✅ hotovo |
| **Funkce otestované deep E2E (30)** | ✅ ~24 bugů opraveno, vše zelené s DB ověřením |
| Feature parity (vs Eventim/DACH) | ✅ ~99 % |
| **✅ Nasazení oprav na prod (FÁZE 1A)** | ✅ HOTOVO — migrace 340–348 + merge + deploy (registrace promotéra na prod 200) |
| **Platby naostro** | ❌ GoPay (~2-3 týdny KYC) |
| **Email** | ❌ Resend (1-2 dny) |
| **Doména** | ⏳ 1 DNS záznam (CNAME `app`→`cname.vercel-dns.com`) |
| Moderace/bezpečnost | ✅ postaveno (čeká `ANTHROPIC_API_KEY` na vision) |
| ENCRYPTION_KEY stabilita | ⚠️ ověřit (kritické — viz FÁZE 1A) |
| **Hot onsale (tisíce/s)** | ⚠️ checkout opraven; zbývá fronta + Neon pooler (FÁZE 2B) — jen pro velké onsale |
| Právní | ⚠️ ověřit |

**Dva paralelní blockery:** (1) **GoPay KYC** (~2-3 týdny, čeká se na ně — začni hned),
(2) **nasazení oprav** (migrace + merge + deploy — to umím udělat hned, jak dostanu prod connection string).

---

### 🎯 Co udělat HNED (tento týden)

**🤖 Co můžu udělat IHNED (čeká jen na tebe drobnost):**
1. **Migrace 340–348 na prod** — pošli mi prod `DATABASE_URL` (Vercel → Settings → Env Vars → Reveal),
   spustím applier. (Bez nasazení je prod registrace promotéra rozbitá.)
2. **Merge větve → master + deploy** — řekni a udělám (doporučuju review velkého diffu).

**🧑 Co je jen na tobě (externí, dlouhé tyče — začni paralelně):**
3. **GoPay smlouva** (nejdelší, ~2-3 týdny KYC)
4. **Resend** — registrace + doména `tixly.cz`
5. **DNS: CNAME `app` → `cname.vercel-dns.com`**
6. **Claude klíč** `ANTHROPIC_API_KEY` (separátní pro Tixly)
7. **Právní** — potvrď Tixly s.r.o./IČO/Fio + ToS/GDPR (CZ+SK)

→ Jakmile pošleš klíče (GoPay/Resend/Claude): 🤖 nastavím env, vypnu mocky, ověřím doménu, smoke testy.
