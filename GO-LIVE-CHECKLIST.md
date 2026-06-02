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
- [ ] **`app.tixly.cz` přes Cloudflare DNS** 🧑+🤖 ⏱ 10 min + propagace
  - Cloudflare → Add Site `tixly.cz` → CNAME `app.tixly.cz` → `cname.vercel-dns.com`
  - [ ] 🤖 přidám doménu ve Vercel project settings + SSL se vystaví automaticky
- [ ] **Vypnout Vercel Deployment Protection** na produkční doméně 🤖 — aby ji zákazníci viděli (teď je na projektových URL 401)

### Právní (CZ + SK)
- [ ] **Ověřit: Tixly s.r.o. + IČO + DIČ** 🧑 (dle poznámek hotové — potvrď)
- [ ] **Ověřit: Fio bankovní účet CZK + EUR** 🧑 (dle poznámek hotové — potvrď)
- [ ] **Obchodní podmínky (ToS) — CZ** 🧑 (právník / šablona)
- [ ] **Obchodní podmínky (ToS) — SK** 🧑 (jiný právní řád)
- [ ] **GDPR / zpracování osobních údajů** 🧑 (CZ zák. 110/2019 + SK 18/2018)
- [ ] **DPH nastavení** — CZ 21 %/10 % kultura, SK 23 %/5 % kultura 🧑 (promotér si nastaví v profilu, ale ověř že to sedí)

---

## 🟡 FÁZE 2 — Silně doporučeno před spuštěním (provoz a důvěra)

- [ ] **Sentry** (error tracking) 🧑 ⏱ 5 min — https://sentry.io → DSN → 🤖 nastavím
- [ ] **Better Uptime** (alert na výpadek) 🧑 ⏱ 5 min — monitor na `/api/health/ready`
- [ ] **Apple Wallet PassType cert** 🧑 ⏱ ~7 dní — Apple Developer Program (99 USD/rok) → `.p12` cert → 🤖 nastavím (teď passy nepodepsané)
- [ ] **Google Wallet issuer** 🧑 ⏱ ~3 dny — service account JSON → 🤖 nastavím
- [ ] **Backup / DR ověření** 🤖 — Neon má automatický PITR, ověřit že je zapnutý

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
| **Doména** | ❌ 10 min |
| Právní | ⚠️ ověřit |
| Ověření „naživo" | ⏳ proklikat |

**Lhůtu spuštění určuje GoPay (~2-3 týdny KYC). Vše ostatní je práce na odpoledne.**

---

### 🎯 Co udělat HNED (tento týden)
1. 🧑 **Začni GoPay smlouvu** (nejdelší, čeká se na ně)
2. 🧑 **Resend doména** (rozjede se DNS propagace na pozadí)
3. 🧑 **Cloudflare doména** `app.tixly.cz`
4. 🤖 řekni a já: nastavím doménu ve Vercelu, vypnu deployment protection, napojím klíče jak přijdou
