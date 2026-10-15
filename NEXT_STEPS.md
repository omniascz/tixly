# Tixly — kde jsme a co dál (stav k 2026-10-08 večer; doplněno kola 19, 20 a 21, 2026-10-15)

## 1. Aktuální stav

- Pracovní větev: **`integrate/2026-10-04`**, shodná s `origin/integrate/2026-10-04`, pracovní strom čistý.
  Poslední commit je ten, který přidal tento soubor (předchozí `715c3c32` — surové logy kol 7–16).
- Všechny větve `fix/*`, `wip/*`, `integrate/*`, `audit/*` jsou pushnuté (žádná „ahead").
- **PR #2** (`integrate/2026-10-04` → `master`, https://github.com/omniascz/tixly/pull/2): otevřený, **nesloučený**,
  bez konfliktů. Kontroly na `715c3c32`: všechny prošly — Install · typecheck · lint · unit, Live sada, Build bez sítě,
  Dependency audit ×4, RLS verify (DB z migrací), Schema drift, Secret scan (Gitleaks), Vercel – nextjs-boilerplate,
  Vercel – tixly; „RLS verify (produkce vs snapshot)" se na PR záměrně přeskakuje. Master se nepushuje, nic se nenasazuje.
- Lokální služby: Postgres/Redis/Mailpit (`fix-pg`, `fix-redis`, `fix-mail`) běží; PgBouncer `fix-pgb` zastaven
  (zapnout: `docker start fix-pgb`).
- **Kolo 18** (staging) skončilo v kroku 0.6 — chybí `staging.keys.env`; větev `fix/round18-staging-2026-10-14` (`716fe3c9`)
  čeká beze změny na pokračování. **Kolo 19** (Sentry 11) sloučeno PR #16 do integrate (`f14ee9d6`).
  **Kolo 20** (pád order-confirmation, Sentry `telemetry: false`) sloučeno PR #17 (`c8ab017d`).
  **Kolo 21** (tokeny z URL — referer, dotaz — do Sentry neodejdou) sloučeno PR #18 (`2203c81c`).

### Sloučená kola 1–17, 19, 20 a 21

| kolo | obsah | sloučení | report |
|---|---|---|---|
| 1 | kritické nálezy K1–K3, V1 | do integrate v kole 5 (`ed318f9b`) | [FIX_REPORT_K.md](FIX_REPORT_K.md) |
| 2 | opravy kola 2 | do integrate v kole 5 (`ed318f9b`) | [FIX_REPORT_R2.md](FIX_REPORT_R2.md) |
| 3 | opravy kola 3 | do integrate v kole 5 (`ed318f9b`) | [FIX_REPORT_R3.md](FIX_REPORT_R3.md) |
| 4 | opravy kola 4, CI na DB z migrací | do integrate v kole 5 (`ed318f9b`) | [FIX_REPORT_R4.md](FIX_REPORT_R4.md) |
| 5 | integrace rozpracované práce + kol 1–4 | `ed318f9b`, PR #2 do master | [INTEGRATION_REPORT.md](INTEGRATION_REPORT.md) |
| 6 | přepnutí `tixly/` na integrate, CI na GitHubu | přímo v integrate (`ed77a3b9`) | [ROUND6_REPORT.md](ROUND6_REPORT.md) |
| 7 | blokery ostrého prodeje (uzávěrka, DPH, výplaty, ARES, brány) | PR #3 `8aadf388` | [ROUND7_REPORT.md](ROUND7_REPORT.md) |
| 8 | divadelní prodej pro turné agenturu | PR #4 `0f3e2186` | [ROUND8_REPORT.md](ROUND8_REPORT.md) |
| 9 | příprava ostrého provozu, staging skripty, runbook | PR #5 `f391fcc2`, PR #6 `3648c81d` | [ROUND9_REPORT.md](ROUND9_REPORT.md) |
| 10 | poslední opravy před stagingem, vypnuté nedokončené cesty | PR #7 `cc1a8c51` | [ROUND10_REPORT.md](ROUND10_REPORT.md) |
| 11 | oprava padajícího Vercel buildu | PR #8 `96eb50ed`, PR #9 `7e7af821` | [ROUND11_REPORT.md](ROUND11_REPORT.md) |
| 12 | provozní příručka, UX průchod | PR #10 `2a1c9102` | [ROUND12_REPORT.md](ROUND12_REPORT.md) |
| 13 | vrácení UX z kola 12, zachovány opravy | PR #11 `7d180770` | [ROUND13_REPORT.md](ROUND13_REPORT.md) |
| 14 | spolehlivost pro den prodeje a představení | PR #12 `b023def1` | [ROUND14_REPORT.md](ROUND14_REPORT.md) |
| 15 | Next.js 14 → 15.5.27 | PR #13 `e6f45c68` | [ROUND15_REPORT.md](ROUND15_REPORT.md) |
| 16 | přihlášení před hydratací, závislosti, kolísavý test | PR #14 `10396c66` | [ROUND16_REPORT.md](ROUND16_REPORT.md) |
| 17 | zátěžový test na GitHub Actions (`loadtest.yml`) | PR #15 `e19c91e0` | [ROUND17_REPORT.md](ROUND17_REPORT.md) |
| 19 | @sentry/nextjs 8.55.2 → 11.7.0, restriktivní sběr osobních údajů, tunel z prohlížeče | PR #16 `f14ee9d6` | [ROUND19_REPORT.md](ROUND19_REPORT.md) |
| 20 | pád stránky potvrzení zaplacené objednávky (datum z pg), `telemetry: false` build pluginu Sentry | PR #17 `c8ab017d` | [ROUND20_REPORT.md](ROUND20_REPORT.md) |
| 21 | tokeny z URL (hlavička referer, parametry dotazu) se nedostanou do Sentry (`scrub-pii.ts`) | PR #18 `2203c81c` | [ROUND21_REPORT.md](ROUND21_REPORT.md) |

## 2. Co čeká na vlastníka

| přístup | k čemu | kde ho získáte |
|---|---|---|
| **Neon API klíč s právem zakládat projekty** | `scripts/staging/create.sh` založí pro staging **samostatný** Neon projekt (ne větev produkce) | console.neon.tech → vpravo nahoře účet / organizace → **Settings → API keys → Create new API key** (klíč organizace nebo osobní; klíč omezený jen na produkční projekt nestačí) |
| **GoPay sandbox** | testovací platby na stagingu, sandbox testy | testovací přístupy (GoID, ClientID, ClientSecret) posílá GoPay po registraci obchodníka — gopay.com, návod help.gopay.com/en/s/wk |
| **ComGate sandbox** (volitelně) | druhá brána v testovacím režimu | portal.comgate.cz → Integrace → Nastavení obchodu → Propojení obchodu (identifikátor e-shopu + heslo); API ComGate pouští jen povolené IP adresy |
| **Resend** | e-maily ze stagingu (vstupenky, obnova hesla) | resend.com → **Domains → Add domain** (např. `staging.tixly.cz`, DNS záznamy u správce domény, počkat na „Verified") → **API Keys → Create API Key** (samostatný klíč jen pro staging) |
| **Vercel Pro** | projekt `nextjs-boilerplate` má 17 z 29 cronů častěji než 1× denně, což tarif Hobby nedovolí (kolo 10); Hobby je navíc jen pro nekomerční použití | vercel.com → tým → **Settings → Billing → Upgrade to Pro** (není to klíč, nic se nikam neukládá) |

## 3. Kam klíče uložit — aby se NIKDY nedostaly do gitu ani do chatu

**Pravidlo:** hodnoty klíčů nikdy nevkládejte do chatu s Claudem, do e-mailu ani do žádného souboru kromě níže
uvedených. Claudovi stačí napsat „klíče jsou uložené" — přečte je ze souboru sám a nevypíše je.

### 3a) Lokální soubor `staging.keys.env` (jen na tomto počítači)

Přesné umístění: **`C:\Users\omnia\Documents\tixly\staging.keys.env`** (kořen repozitáře, vedle tohoto souboru).
Git ho ignoruje (`.gitignore`, řádek `staging.keys.env`; ověřeno `git check-ignore`), navíc CI kontroluje únik tajemství
(Gitleaks). Vedle něj vznikne zítra `staging.env` — ten zapíše skript `create.sh` (adresy staging databáze a heslo
demo pořadatele) a git ho také ignoruje.

Postup krok po kroku:
1. Stiskněte klávesu Windows, napište `Poznámkový blok` a otevřete ho.
2. Vložte tento text (zatím bez hodnot):
   ```
   NEON_API_KEY=
   GOPAY_SANDBOX_GOID=
   GOPAY_SANDBOX_CLIENT_ID=
   GOPAY_SANDBOX_CLIENT_SECRET=
   COMGATE_SANDBOX_MERCHANT=
   COMGATE_SANDBOX_SECRET=
   RESEND_API_KEY=
   STAGING_EMAIL_ALLOWLIST=
   STAGING_SMOKE_EMAIL=
   ```
3. Za každé `=` vložte příslušnou hodnotu (bez mezer a bez uvozovek). Co nemáte (např. ComGate), nechte prázdné.
   - `STAGING_EMAIL_ALLOWLIST` = adresy, kam smí staging posílat e-maily, oddělené čárkou (např. `vy@firma.cz, @firma.cz`).
   - `STAGING_SMOKE_EMAIL` = jedna adresa z allowlistu, na kterou přijde testovací e-mail.
4. **Soubor → Uložit jako**: složka `C:\Users\omnia\Documents\tixly`, **Uložit jako typ: Všechny soubory (\*.\*)**,
   **Název souboru: `staging.keys.env`** → Uložit. (Bez volby „Všechny soubory" by Windows přidal `.txt`.)
5. Kontrola: v Průzkumníku ve složce `tixly` musí být soubor přesně `staging.keys.env` (ne `staging.keys.env.txt`).
   Claude zítra ověří příkazem `git check-ignore -v staging.keys.env`, že ho git ignoruje, a `git status`, že se neukazuje.

### 3b) Vercel Environment Variables — prostředí **Preview** (staging), nikdy Production

Vercel → projekt **`nextjs-boilerplate`** → **Settings → Environment Variables** → pro každou proměnnou:
**Key** = název, **Value** = hodnota, v **Environments** zaškrtnout **jen Preview** (odškrtnout Production a
Development) → **Save**. Seznam všech proměnných je v `scripts/staging/vercel-preview.env.example`; klíče z bodu 2 jdou takto:

| hodnota ze `staging.keys.env` | název ve Vercelu (Preview) | navíc nastavit |
|---|---|---|
| `GOPAY_SANDBOX_GOID` | `GOPAY_GOID` | `GOPAY_SANDBOX=true`, `PAYMENT_PROVIDER=gopay` |
| `GOPAY_SANDBOX_CLIENT_ID` | `GOPAY_CLIENT_ID` | |
| `GOPAY_SANDBOX_CLIENT_SECRET` | `GOPAY_CLIENT_SECRET` | |
| `COMGATE_SANDBOX_MERCHANT` | `COMGATE_MERCHANT` | `COMGATE_TEST=true` |
| `COMGATE_SANDBOX_SECRET` | `COMGATE_SECRET` | |
| `RESEND_API_KEY` | `RESEND_API_KEY` **a** `SMTP_PASS` (stejná hodnota) | `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`, `SMTP_USER=resend`, `SMTP_SECURE=false`, `EMAIL_FROM` / `MAIL_FROM` na ověřené doméně |
| `STAGING_EMAIL_ALLOWLIST` | `STAGING_EMAIL_ALLOWLIST` | `TIXLY_ENV=staging` (pojistka: bez allowlistu staging nenastartuje) |
| — (ze `staging.env` po `create.sh`) | `DATABASE_URL`, `DATABASE_URL_DIRECT`, `DATABASE_URL_SUPER`, `DATABASE_URL_OPS` | |
| — (vygeneruje Claude do `staging.keys.env`, nevypíše je) | `JWT_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_SERVICE_TOKEN`, `CRON_SECRET`, `EMAIL_VERIFY_SECRET`, `TICKET_MAGIC_SECRET`, `HMAC_SECRET` | vlastní pro staging, nikdy produkční |

`NEON_API_KEY` a `STAGING_SMOKE_EMAIL` do Vercelu **nepatří** (potřebuje je jen `create.sh` / `smoke.sh` na tomto počítači).
Vercel Pro se nikam neukládá.

### 3c) GitHub secrets — nic

Repozitář má dnes **0 secrets** a žádný workflow sandboxové klíče, Resend ani Neon klíč pro staging nepotřebuje.
**Žádný z klíčů výše do GitHub secrets nedávejte.** Pozor zvlášť na `NEON_API_KEY`: workflow `rls-gate.yml` čte secret
stejného jména pro noční kontrolu **produkčního** projektu (klíč omezený na ten projekt) — klíč pro zakládání stagingu
tam nepatří.

## 4. První krok zítra — rozjetí stagingu a smoke test (`scripts/staging/README.md`)

1. Vlastník: přístupy z bodu 2 → `staging.keys.env` (3a) a Vercel Pro.
2. Claude: `git check-ignore -v staging.keys.env staging.env` a `git status` (soubory se nesmí ukázat).
3. Claude: `scripts/staging/create.sh --dry-run`, pak `create.sh` s `NEON_API_KEY` načteným ze `staging.keys.env`
   → samostatný Neon projekt, migrace od nuly, role `tixly_app` (NOBYPASSRLS), demo data, `staging.env`.
4. Claude: vygeneruje tajné klíče stagingu do `staging.keys.env` (bez vypsání); vlastník podle tabulky 3b vyplní
   Vercel → Preview (Claude připraví seznam názvů, hodnoty si vlastník zkopíruje ze souborů sám).
5. Nový preview deploy větve `integrate/2026-10-04`, ověřit, že pojistka `TIXLY_ENV=staging` server pustila
   (žádné „staging-guard" v logu), a nastavit `APP_URL` / `NEXT_PUBLIC_APP_URL` na adresu stagingu.
6. Smoke test: `STAGING_URL=<adresa stagingu> scripts/staging/smoke.sh --dry-run`, pak naostro
   (`RESEND_API_KEY`, `STAGING_SMOKE_EMAIL` ze `staging.keys.env`): zdraví, přihlášení, e-mail na allowlist odešel /
   mimo allowlist ne, sandbox testy GoPay (a ComGate) — platbu v sandboxu potvrzuje člověk testovací kartou.
   Pozor: ComGate API pouští jen povolené IP; Vercel nemá pevnou IP — ověřit zítra, případně ComGate na stagingu vynechat.

## 5. Známé otevřené body

- **Sentry 11.7.0 (kolo 19)** — ověřeno jen proti lokálnímu simulátoru, ne proti skutečnému sentry.io. Nová proměnná
  není; release = `APP_VERSION` ?? `NEXT_PUBLIC_APP_VERSION` ?? `VERCEL_GIT_COMMIT_SHA`. Po nasazení s DSN ověřit
  `POST /api/ops/sentry-check` (Bearer `CRON_SECRET`) a jednu chybu z prohlížeče přes `/api/monitoring`.
  Build plugin Sentry posílá při každém buildu s `SENTRY_DSN` telemetrii (verze pluginu/bundleru) na sentry.io — jako
  dřív v SDK 8 — **od kola 20 vypnuto** (`telemetry: false`; lokální build s DSN 5 → 0 pokusů o spojení ven).
  SDK doporučuje hook `onRequestError` (chyby vnořených RSC) a `instrumentation-client.ts` — nepřidáno (nové chování).
- **Opraveno v kole 20:** „d.event_date_start.replace is not a function" na `/[locale]/order-confirmation/[orderId]`
  (zaplacená objednávka vracela 500). Grep stejného vzoru v src/app a src/lib: 18 výskytů, 0 kandidátů
  (`logs/r20/1_grep_dates.md`). Kandidáti na další kolo: (1) `<timestamptz>::text` + `slice(0, 10)` dává datum v časové
  zóně relace DB (lokálně UTC), ne Europe/Prague — date-holds, offers, theatre-reports, songkick (posun o den u akcí po 23:00 SEČ);
  (2) ~~span Sentry nese hlavičku `referer` s dotazem~~ — **opraveno v kole 21**;
  (3) specy `golden-path-buyer` a `golden-path-benefit` jsou zastaralé (text „Cenové kategorie" v UI není, login bez Origin →
  CSRF 403, kód chyby `NOT_FOUND`) v kolech 10–19 se nespouštěly, v kole 20 neprošly; potřebují aktualizaci nebo vyřazení.
- **Kolo 21 — tokeny v URL do Sentry:** referer bez dotazu a fragmentu, hodnoty 27 názvů parametrů → `[skryto]`
  (soupis `logs/r21/1_url_secrets.md`). Kandidáti na další kolo (tajemství v **segmentu cesty**, neopraveno):
  `/{locale}/t/{token}`, `/api/public/tickets/{token}/totp`, `/charity/claim/{token}`, `/foyer/pickup/{token}`,
  `/gift/{token}` a `/api/gift/{token}`, `/group/{token}` a `/api/group-invitations/{token}`, `/lottery/result/{token}`,
  `/reschedule/{token}`, `/review/{token}`, `/season-pass/{passToken}`, `/tickets/transfer/{token}`, `/transfer/accept/{token}`,
  `/nabidka/{token}` a `/api/offers/{token}`, `/party/{token}` a `/api/checkout/party-split/{token}`, `/api/queue/{id}/status/{token}`,
  `/api/vouchers/{code}/pdf`, `/api/buyer/gift-cards/{code}`, `/api/buyer/announcements/{token}/respond`,
  `/cs/order-confirmation/{orderId}`; odchozí Fio `…/rest/…/{token}` a Przelewy24 `…/trnRequest/{token}` (úplný seznam v soupisu).
  Mimo Sentry: TOTP secret v URL obrázku api.qrserver.com (2FA, dárek). Postřehy soupisu k ověření v dalším kole (neověřeno
  testem): share-card přijme libovolný `?token=`, `/api/buyer/announcements/{token}/respond` bez přihlášení, `lotteryEntryId`
  v checkoutu bez vazby na kupce, admin/live předává JWT v `?token=`.
- **Vypnuté cesty bez napojení na platbu** — přepínače `NEXT_PUBLIC_FEATURE_INSTALLMENTS` (splátky, BNPL),
  `NEXT_PUBLIC_FEATURE_SUBSCRIPTIONS` (předplatné, permanentky), `NEXT_PUBLIC_FEATURE_BENEFIT_CARDS` (benefitní karty);
  výchozí vypnuto, na stagingu nenastavovat (kolo 10).
- **Abonmá a dárkové poukazy** — odloženo.
- **QR politika existujících akcí** — čeká na rozhodnutí vlastníka.
- **Jméno u existujícího účtu při prodeji na pokladně** — ponecháno: pokladní prodej jméno existujícího účtu nepřepíše
  (trigger `identity.sync_user_name`), produktové rozhodnutí (kolo 14).
- Zátěž: na runneru GitHub Actions se cíl p95 hold/checkout < 1,5 s liší podle stroje; regrese verzí hlídá
  `loadtest.yml` s `baseline_ref` (kolo 17).
