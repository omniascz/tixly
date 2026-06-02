# 🚀 Tixly — GO-LIVE Checklist (cesta k 100 % ostrému provozu)

> Odškrtávej `[ ]` → `[x]`, jak postupuješ. Aktualizováno: 2026-06-02.
> **Legenda:** 🧑 = ty (tvůj účet/billing/podpis) · 🤖 = udělám/pomůžu já · ⏱ = doba · 🔗 = na čem to závisí

---

## ✅ FÁZE 0 — Hotovo (technický základ stojí)

- [x] **Vercel hosting** + auto-deploy z `master` (🤖)
- [x] **Vercel build OPRAVEN** — chyběl Root Directory `nextjs-boilerplate` (🤖) — první úspěšný build v historii
- [x] **Neon Postgres (produkce)** — domigrováno na 339, ověřeno zdravé (🤖)
- [x] **Upstash Redis** — provisionováno, ověřeno (DB+Redis ok) (🤖)
- [x] **Klíče/secrets na Vercelu** — JWT, ENCRYPTION_KEY, CRON, INTERNAL, VAPID (🤖)
- [x] **RLS Fáze 2** (tenant izolace) — mergnuto do master, na prod dormant (🤖)
- [x] **Produkce běží** — `health/ready {database:ok, redis:ok}`, login funguje (🤖)
- [x] **Re-ověřeno 2026-06-02** — prod `health/ready` 200 `{database:ok, redis:ok}` (🤖)
- [x] **Moderace obsahu — vision** — Claude posuzuje text I plakát; finální schválení master admin (🤖, viz FÁZE 1 → Bezpečnost)

> **Stav: tech stack je nasazený a běžící.** Zbývají externí účty + ověření.

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

## 🔍 FÁZE 4 — Ověření „funguje to NAŽIVO" (ne jen v testech)

> Tvůj princip: *funkční demo, ne reporty „vše zelené".* Proklikat jako reálný promotér.

- [ ] **Golden path naostro** 🧑+🤖 — kup lístek na produkci od začátku do konce (browse → sedadlo → checkout → platba → lístek mailem → vstup sken)
- [ ] **Založení akce** — proklikat wizard jako promotér
- [ ] **Velký festival** — modulární pass (den × pódium), cross-pass, sken
- [ ] **Divadelní abonentka** — Wahl-Abo (výběr X představení)
- [ ] **Resale (FanSALE)** — prodej lístku dál + reissue
- [ ] **Pojištění storna** — checkbox v checkoutu + claim
- [ ] **Refund** — vrátit peníze, uvolnit sedadlo
- [ ] **POS + Scanner** — prodej na místě + sken u vstupu
- [ ] **Wallet** — Apple/Google Wallet pass
- [ ] **Promotér onboarding** — registrace nového promotéra od nuly
- [ ] **Master admin** — schválení promotéra, moderace, výplaty

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
| Feature parity (vs Eventim/DACH) | ✅ ~99 % (18/21 end-to-end, 3 mock) |
| Velký festival | ✅ umíme |
| **Platby naostro** | ❌ GoPay (~14 dní) |
| **Email** | ❌ Resend (1-2 dny) |
| **Doména** | ⏳ 1 DNS záznam (CNAME `app`→`cname.vercel-dns.com`) — vše ostatní 🤖 hotovo |
| Moderace/bezpečnost | ✅ postaveno (čeká jen `ANTHROPIC_API_KEY` na vision) |
| Právní | ⚠️ ověřit |
| Ověření „naživo" | ⏳ proklikat |

**Lhůtu spuštění určuje GoPay (~2-3 týdny KYC). Vše ostatní je práce na odpoledne.**

---

### 🎯 Co udělat HNED (tento týden) — vše je na TOBĚ (🧑), tech je připravený
1. 🧑 **Začni GoPay smlouvu** (nejdelší tyč, ~2-3 týdny KYC — čeká se na ně)
2. 🧑 **Resend** — registrace + přidat doménu `tixly.cz` (rozjede se DNS propagace na pozadí)
3. 🧑 **DNS: CNAME `app` → `cname.vercel-dns.com`** (doména je už přidaná ve Vercelu, čeká jen na tenhle záznam)
4. 🧑 **Claude klíč** (`ANTHROPIC_API_KEY`) — separátní pro Tixly
5. 🤖 jakmile pošleš klíče (GoPay / Resend / Claude): nastavím env, vypnu `GOPAY_MOCK`, `MODERATION_PROVIDER=claude`, ověřím doménu + HTTPS, spustím smoke testy
